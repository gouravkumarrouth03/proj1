from contextlib import closing
from hashlib import pbkdf2_hmac
from hmac import compare_digest
from pathlib import Path
import base64
import os
import random
import sqlite3
import logging
from typing import List, Optional
from datetime import datetime, date, timedelta

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── ML / Data imports ──────────────────────────────────────────────────────────
try:
    import joblib
    import pandas as pd
    import numpy as np
    import requests as http_requests
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
    logging.warning("ML packages not installed. Falling back to formula-based predictions.")

# ── Constants ──────────────────────────────────────────────────────────────────
DEFAULT_DATABASE_PATH = Path(__file__).with_name("paimana.db")
DATABASE_PATH = Path(os.getenv("MOSPI_DATABASE_PATH", str(DEFAULT_DATABASE_PATH))).expanduser()
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
MODELS_DIR = Path(__file__).parent.parent  # project root where .pkl files live

COST_MODEL_PATH = MODELS_DIR / "xgboost_cost_overrun_model.pkl"
DELAY_MODEL_PATH = MODELS_DIR / "xgboost_delay_model_enhanced.pkl"

# ── Load trained models at startup ─────────────────────────────────────────────
cost_model = None
delay_model = None

if ML_AVAILABLE:
    # Compatibility shim for unpickling pipelines across sklearn versions
    try:
        import sklearn.compose._column_transformer as _ct
        if not hasattr(_ct, "_RemainderColsList"):
            class _RemainderColsList(list):
                pass
            _ct._RemainderColsList = _RemainderColsList
    except Exception:
        pass

    try:
        cost_model = joblib.load(COST_MODEL_PATH)
        logging.info(f"✅ Cost overrun model loaded from {COST_MODEL_PATH}")
    except Exception as e:
        logging.error(f"❌ Could not load cost overrun model: {e}")

    try:
        delay_model = joblib.load(DELAY_MODEL_PATH)
        logging.info(f"✅ Delay model loaded from {DELAY_MODEL_PATH}")
    except Exception as e:
        logging.error(f"❌ Could not load delay model: {e}")

# ── Hilly states list (matches notebook exactly) ───────────────────────────────
HILLY_STATES = {
    'Jammu & Kashmir', 'Himachal Pradesh', 'Uttarakhand', 'Sikkim',
    'Arunachal Pradesh', 'Meghalaya', 'Nagaland', 'Manipur', 'Mizoram', 'Tripura'
}
MULTI_STATES = {'Multi-State', 'Pan India', 'Multiple'}

# Top states used for Clean_State feature (matches notebook Cell 50 exactly)
TOP_STATES = {
    'Maharashtra', 'Uttar Pradesh', 'Madhya Pradesh', 'Andhra Pradesh',
    'Tamil Nadu', 'Gujarat', 'Bihar', 'Karnataka', 'Odisha',
    'Telangana', 'West Bengal', 'Rajasthan'
}

# ── Sector → MoSPI canonical mapping ──────────────────────────────────────────
SECTOR_MAP = {
    'Transport & Logistics': 'Roads',
    'Energy': 'Power',
    'Water & Sanitation': 'Water',
    'Communication': 'Telecom',
    'Social Infrastructure': 'Social',
    'Coal': 'Coal',
    'Steel': 'Steel',
    'Mining': 'Mining',
    'Urban Development': 'Urban',
}

# ── Ministry short-code → canonical MoSPI ministry string ─────────────────────
MINISTRY_MAP = {
    'MoRTH': 'MoRTH',
    'MoP': 'MoP',
    'MoPNG': 'MoPNG',
    'MoJSH': 'MoJSH',
    'MoHUA': 'MoHUA',
    'MoC': 'MoC',
    'MoR': 'MoR',
}

# ── FastAPI app ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="MoSPI Infrastructure Project Monitoring & Risk Analytics System (IPMD)",
    description="Infrastructure and Project Monitoring Division (IPMD), Ministry of Statistics and Programme Implementation, Government of India.",
    version="2.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ────────────────────────────────────────────────────────────
class LoginInput(BaseModel):
    role: str
    name: str
    password: str


class RegisterInput(BaseModel):
    name: str
    role: str
    password: str


class UserResponse(BaseModel):
    id: int
    name: str
    role: str


class UserItem(BaseModel):
    id: int
    name: str
    role: str
    created_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    is_online: bool = False


class NotificationItem(BaseModel):
    id: int
    user_id: int
    project_id: str
    project_name: str
    message: str
    alert_type: str
    created_at: str
    read_at: Optional[str] = None


class DatabaseStats(BaseModel):
    database_file: str
    database_size_bytes: int
    total_projects: int
    total_users: int
    total_admins: int
    total_regular_users: int
    total_inspectors: Optional[int] = 0
    status: str


class ProjectStat(BaseModel):
    id: str
    name: str
    sector: str
    original_cost: float
    revised_cost: float
    expenditure: float
    status: str
    risk_score: float
    cost_overrun_prob: float
    time_delay_prob: float
    ministry: Optional[str] = "MoRTH"
    agency: Optional[str] = "NHAI"
    location: Optional[str] = "India"
    physical_progress: Optional[float] = 25.0
    start_date: Optional[str] = None
    expected_end_date: Optional[str] = None
    approval_date: Optional[str] = None
    revised_completion_date: Optional[str] = None
    project_status: Optional[str] = "Ongoing"
    description: Optional[str] = ""
    assigned_inspector: Optional[str] = "Inspector Sharma"
    assigned_inspector_id: Optional[int] = None
    assigned_officer_id: Optional[int] = None
    inspection_notes: Optional[str] = ""
    last_inspected_at: Optional[str] = None


class CreateProjectInput(BaseModel):
    name: str
    sector: str
    original_cost: float
    revised_cost: float
    expenditure: Optional[float] = 0.0
    ministry: Optional[str] = "MoRTH"
    agency: Optional[str] = "NHAI"
    location: Optional[str] = "India"
    physical_progress: Optional[float] = 0.0
    start_date: Optional[str] = None
    expected_end_date: Optional[str] = None
    approval_date: Optional[str] = None
    revised_completion_date: Optional[str] = None
    project_status: Optional[str] = "Ongoing"
    description: Optional[str] = ""
    assigned_inspector: Optional[str] = "Inspector Sharma"
    assigned_inspector_id: Optional[int] = None
    inspection_notes: Optional[str] = ""


class UpdateProjectStatusInput(BaseModel):
    status: Optional[str] = None
    project_status: Optional[str] = None
    physical_progress: Optional[float] = None
    revised_completion_date: Optional[str] = None
    inspection_notes: Optional[str] = None
    assigned_inspector: Optional[str] = None


class AssignInspectorInput(BaseModel):
    assigned_inspector: Optional[str] = None
    assigned_inspector_id: Optional[int] = None
    assigned_officer_id: Optional[int] = None


class PredictInput(BaseModel):
    project_id: Optional[str] = None
    sector: str
    original_cost: float
    revised_cost: float
    expenditure: Optional[float] = 0.0
    physical_progress: Optional[float] = 0.0
    # Extended fields for real ML inference
    ministry: Optional[str] = "MoRTH"
    state: Optional[str] = "Maharashtra"
    start_date: Optional[str] = None
    expected_end_date: Optional[str] = None


class MLPredictionResult(BaseModel):
    risk_score: float
    risk_level: str
    cost_overrun_prob: float
    time_delay_prob: float
    predicted_cost_overrun_cr: float
    predicted_delay_months: int
    top_risk_factors: List[str]
    recommended_action: str
    model_source: Optional[str] = "formula"
    baseline_delay_months: Optional[float] = None
    dynamic_adjusted_delay_months: Optional[float] = None
    live_signals: Optional[dict] = None
    risk_badge: Optional[str] = None


class ProjectPayload(BaseModel):
    canonical_id: Optional[str] = "PRJ-DEFAULT"
    ministry: str
    sector: str
    state: str
    terrain_difficulty: Optional[str] = "Medium"
    original_cost_cr: float
    cumulative_expenditure_cr: float
    physical_progress_pct: float
    progress_velocity: float
    expenditure_velocity_cr: float
    planned_duration_months: int
    latitude: Optional[float] = 25.6  
    longitude: Optional[float] = 85.1
    save_to_db: Optional[bool] = False


class DashboardOverview(BaseModel):
    total_projects: int
    total_original_cost: float
    total_revised_cost: float
    total_expenditure: float
    high_risk_projects: int
    critical_alerts: int


def get_current_user(
    session_user_id: Optional[int] = Header(default=None, alias="X-User-ID"),
    user_role: Optional[str] = Header(default=None, alias="X-User-Role"),
) -> sqlite3.Row:
    """Resolve the signed-in account used by the role-aware portal actions."""
    if session_user_id is None or not user_role:
        raise HTTPException(status_code=401, detail="Authentication required")

    with closing(get_connection()) as connection:
        user = connection.execute(
            "SELECT id, name, role FROM users WHERE id = ? AND role = ?",
            (session_user_id, user_role.strip().lower()),
        ).fetchone()
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid user session")
    return user


def require_role(*roles: str):
    def dependency(user: sqlite3.Row = Depends(get_current_user)) -> sqlite3.Row:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="You do not have permission for this action")
        return user
    return dependency


def get_optional_user(
    user_id: Optional[int] = Header(default=None, alias="X-User-ID"),
    user_role: Optional[str] = Header(default=None, alias="X-User-Role"),
) -> Optional[sqlite3.Row]:
    if user_id is None and not user_role:
        return None
    if user_id is None or not user_role:
        raise HTTPException(status_code=401, detail="Invalid user session")
    with closing(get_connection()) as connection:
        user = connection.execute(
            "SELECT id, name, role FROM users WHERE id = ? AND role = ?",
            (user_id, user_role.strip().lower()),
        ).fetchone()
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid user session")
    return user


# ── Feature engineering helpers ────────────────────────────────────────────────
def _derive_terrain(state: str) -> str:
    """Derive terrain difficulty from state name, matching notebook logic."""
    if state in HILLY_STATES:
        return "High"
    if state in MULTI_STATES:
        return "High"
    return "Medium"


def _planned_duration_months(start_date: Optional[str], end_date: Optional[str]) -> int:
    """Calculate planned project duration in months from ISO date strings."""
    try:
        if start_date and end_date:
            s = datetime.fromisoformat(start_date)
            e = datetime.fromisoformat(end_date)
            months = (e.year - s.year) * 12 + (e.month - s.month)
            return max(1, months)
    except Exception:
        pass
    return 36  # sensible default for Indian infra projects


def _elapsed_months(start_date: Optional[str]) -> float:
    """How many months have elapsed since project start."""
    try:
        if start_date:
            s = datetime.fromisoformat(start_date)
            now = datetime.utcnow()
            months = (now.year - s.year) * 12 + (now.month - s.month)
            return max(1.0, float(months))
    except Exception:
        pass
    return 12.0  # assume 1 year elapsed by default


# ── Live Weather, Commodity & Disruption Signals (from mospi_advanced_api) ─────
STATE_COORDS = {
    'Maharashtra': (19.75, 75.71),
    'Rajasthan': (26.45, 74.22),
    'Uttar Pradesh': (26.85, 80.91),
    'Gujarat': (22.25, 71.19),
    'Madhya Pradesh': (23.47, 77.95),
    'Karnataka': (15.32, 75.71),
    'Tamil Nadu': (11.13, 78.66),
    'West Bengal': (22.99, 87.85),
    'Odisha': (20.94, 85.10),
    'Punjab': (31.14, 75.34),
    'Haryana': (29.05, 76.08),
    'Bihar': (25.09, 85.31),
    'Andhra Pradesh': (15.91, 79.74),
    'Telangana': (18.11, 79.01),
    'Assam': (26.20, 92.93),
}

def get_live_weather_risk(lat: float, lon: float) -> dict:
    """
    Live Weather API (Real Open-Meteo Data) - matching mospi_advanced_api
    """
    try:
        url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=precipitation_sum&timezone=auto"
        res = http_requests.get(url, timeout=3).json()
        total_rain_7d = sum(res.get("daily", {}).get("precipitation_sum", [0]) or [0])
        if total_rain_7d > 100:
            return {"risk_level": "HIGH", "delay_adder": 1.5, "reason": "Severe rainfall/flood alert"}
        elif total_rain_7d > 40:
            return {"risk_level": "MEDIUM", "delay_adder": 0.5, "reason": "Moderate rainfall warning"}
        return {"risk_level": "LOW", "delay_adder": 0.0, "reason": "Normal weather"}
    except Exception:
        return {"risk_level": "NORMAL", "delay_adder": 0.0, "reason": "Weather service offline"}

# Material Weighting Matrix (Enterprise Commodity Logic)
MATERIAL_MATRIX = {
    "Roads": {"steel": 0.15, "cement": 0.40, "bitumen": 0.45},
    "Railways": {"steel": 0.60, "cement": 0.20, "copper": 0.20},
    "Power": {"steel": 0.40, "cement": 0.30, "copper": 0.30}
}

def get_commodity_risk(sector: str) -> dict:
    """
    Enterprise Commodity Risk Logic from mospi_advanced_api
    """
    live_market_inflation = {"steel": 12.5, "cement": 3.0, "bitumen": 8.0, "copper": 15.0}
    weights = MATERIAL_MATRIX.get(sector, {"steel": 0.33, "cement": 0.33, "bitumen": 0.34})
    total_cost_shock_pct = sum((weights.get(mat, 0) * live_market_inflation.get(mat, 0)) for mat in weights)
    
    if total_cost_shock_pct > 8.0:
        return {"risk_level": "HIGH", "delay_adder": 2.0, "reason": f"{sector} materials inflated by {total_cost_shock_pct:.1f}%"}
    return {"risk_level": "LOW", "delay_adder": 0.0, "reason": "Commodity prices stable"}

def get_local_disruption_risk(state: str, sector: str) -> dict:
    """
    Local Disruption / News Alert simulation from mospi_advanced_api
    """
    if random.random() > 0.8: 
        return {"risk_level": "CRITICAL", "delay_adder": 3.0, "reason": f"News Alert: Land dispute detected for {sector} in {state}"}
    return {"risk_level": "LOW", "delay_adder": 0.0, "reason": "No local disruptions in news"}


# ── Real ML prediction ─────────────────────────────────────────────────────────
def run_real_ml_prediction(
    orig_cost: float,
    rev_cost: float,
    exp: float,
    progress: float,
    sector: str,
    ministry: str = "MoRTH",
    state: str = "Maharashtra",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> MLPredictionResult:
    """
    Run inference using the two trained XGBoost pipelines.
    Falls back to formula if models are unavailable.
    """
    if not ML_AVAILABLE or (cost_model is None and delay_model is None):
        return _formula_fallback(orig_cost, rev_cost, exp, progress, sector)

    # ── Derive engineered features ─────────────────────────────────────────
    planned_months = _planned_duration_months(start_date, end_date)
    elapsed = _elapsed_months(start_date)
    progress_velocity = round(progress / elapsed, 4) if elapsed > 0 else 0.0
    exp_velocity = round(exp / elapsed, 4) if elapsed > 0 else 0.0
    terrain = _derive_terrain(state)

    # Map frontend sector label → MoSPI canonical
    canonical_sector = SECTOR_MAP.get(sector, sector)
    # Ministry: strip anything after ' - ' that the frontend may append
    canonical_ministry = ministry.split(" - ")[0].strip() if ministry else "MoRTH"

    # EVM (Earned Value Management) derived features — matches notebook Cell 50 exactly
    financial_progress_pct = min(200.0, (exp / (orig_cost + 1e-5)) * 100)
    burn_mismatch_ratio = min(10.0, (financial_progress_pct + 1e-5) / (progress + 1e-5))
    spend_per_planned_month = orig_cost / (planned_months + 1e-5)

    # Clean_State: top 12 states by name, everything else → 'Multi-State / Other'
    clean_state = state if state in TOP_STATES else 'Multi-State / Other'

    # ── Cost Overrun Model ────────────────────────────────────────────────
    # Features: Clean_State, Sector, Terrain_Difficulty (categorical)
    #           Original_Cost_Cr, Physical_Progress_Pct, Financial_Progress_Pct,
    #           Burn_Mismatch_Ratio, Progress_Velocity, Expenditure_Velocity_Cr,
    #           Spend_Per_Planned_Month, Planned_Duration_Months (numerical)
    cost_overrun_pct = 0.0
    cost_model_used = False
    if cost_model is not None:
        try:
            cost_features = pd.DataFrame([{
                'Clean_State': clean_state,
                'Sector': canonical_sector,
                'Terrain_Difficulty': terrain,
                'Original_Cost_Cr': orig_cost,
                'Physical_Progress_Pct': progress,
                'Financial_Progress_Pct': financial_progress_pct,
                'Burn_Mismatch_Ratio': burn_mismatch_ratio,
                'Progress_Velocity': progress_velocity,
                'Expenditure_Velocity_Cr': exp_velocity,
                'Spend_Per_Planned_Month': spend_per_planned_month,
                'Planned_Duration_Months': planned_months,
            }])
            cost_overrun_pct = float(cost_model.predict(cost_features)[0])
            cost_overrun_pct = max(0.0, cost_overrun_pct)
            cost_model_used = True
        except Exception as e:
            logging.warning(f"Cost model inference failed: {e}. Using formula fallback.")
            cost_overrun_pct = max(0.0, ((rev_cost - orig_cost) / orig_cost) * 100) if orig_cost > 0 else 0.0

    if not cost_model_used:
        cost_overrun_pct = max(0.0, ((rev_cost - orig_cost) / orig_cost) * 100) if orig_cost > 0 else 0.0

    # ── Delay Model ───────────────────────────────────────────────────────
    # Features: Ministry, Sector, State, Terrain_Difficulty (categorical)
    #           Original_Cost_Cr, Cumulative_Expenditure_Cr, Physical_Progress_Pct,
    #           Progress_Velocity, Expenditure_Velocity_Cr, Planned_Duration_Months (numerical)
    baseline_delay = 0.0
    delay_model_used = False
    if delay_model is not None:
        try:
            delay_features = pd.DataFrame([{
                'Ministry': canonical_ministry,
                'Sector': canonical_sector,
                'State': state,
                'Terrain_Difficulty': terrain,
                'Original_Cost_Cr': orig_cost,
                'Cumulative_Expenditure_Cr': exp,
                'Physical_Progress_Pct': progress,
                'Progress_Velocity': progress_velocity,
                'Expenditure_Velocity_Cr': exp_velocity,
                'Planned_Duration_Months': planned_months,
            }])
            baseline_delay = float(delay_model.predict(delay_features)[0])
            baseline_delay = max(0.0, baseline_delay)
            delay_model_used = True
        except Exception as e:
            logging.warning(f"Delay model inference failed: {e}. Using formula fallback.")

    # Apply live signals (weather, commodities, local disruptions) from mospi_advanced_api
    lat, lon = STATE_COORDS.get(state, (25.6, 85.1))
    weather = get_live_weather_risk(lat, lon)
    commodity = get_commodity_risk(canonical_sector)
    news = get_local_disruption_risk(state, canonical_sector)

    weather_adder = weather.get("delay_adder", 0.0)
    commodity_adder = commodity.get("delay_adder", 0.0)
    news_adder = news.get("delay_adder", 0.0)

    total_delay_months = baseline_delay + weather_adder + commodity_adder + news_adder

    # ── Map model outputs → unified MLPredictionResult ─────────────────────
    # cost_overrun_pct → cost_overrun_prob (probability 0–1)
    cost_overrun_prob = round(min(0.96, max(0.04, cost_overrun_pct / 100.0 * 2.5)), 2)

    # delay → time_delay_prob
    if delay_model_used:
        time_delay_prob = round(min(0.95, max(0.05, total_delay_months / 24.0)), 2)
    else:
        time_delay_prob = round(min(0.95, max(0.10, (1 - (progress / 100)) * 0.6 + (cost_overrun_pct / 100) * 0.2)), 2)

    # Risk score: blended from both model outputs
    raw_risk = (cost_overrun_prob * 55) + (time_delay_prob * 45)
    risk_score = round(min(98.0, max(8.0, raw_risk)), 1)

    risk_level = "High" if risk_score >= 70 else ("Medium" if risk_score >= 45 else "Low")
    risk_badge = "CRITICAL RISK" if total_delay_months > 24 else ("HIGH RISK" if total_delay_months > 12 else "ON TRACK")

    # Projected additional overrun in ₹ Cr
    predicted_cost_overrun_cr = round(max(0.0, (cost_overrun_pct / 100.0) * orig_cost), 2)

    # Predicted delay (integer months)
    predicted_delay_months = int(round(total_delay_months)) if delay_model_used else int(
        max(0, round(time_delay_prob * 18 + (100 - progress) * 0.1))
    )

    # ── Build top risk factors ────────────────────────────────────────────
    factors = []
    if cost_overrun_pct > 10:
        factors.append(f"Model predicts {cost_overrun_pct:.1f}% cost overrun above original budget")
    if rev_cost > orig_cost:
        overrun_actual = ((rev_cost - orig_cost) / orig_cost) * 100
        if overrun_actual > 5:
            factors.append(f"Revised cost already {overrun_actual:.1f}% above original sanction")
    if progress < 40 and elapsed > 18:
        factors.append(f"Physical progress at only {progress:.0f}% after {elapsed:.0f} months elapsed")
    if total_delay_months > 6:
        factors.append(f"Model forecasts {total_delay_months:.1f} months delay (baseline {baseline_delay:.1f}m + signals)")
    if commodity.get("risk_level") == "HIGH":
        factors.append(commodity.get("reason", "Commodity inflation risk"))
    if news.get("risk_level") == "CRITICAL":
        factors.append(news.get("reason", "Local disruption alert"))
    if weather.get("risk_level") in ["HIGH", "MEDIUM"]:
        factors.append(f"Weather alert: {weather.get('reason')}")
    if terrain == "High":
        factors.append(f"High terrain difficulty for {state} raises execution risk")
    if not factors:
        factors.append("Project parameters within permissible variance — continue monitoring")

    # ── Recommended action ────────────────────────────────────────────────
    recommendations = {
        "High": "Mandatory MoSPI high-level steering committee review within 14 days. Re-baseline procurement timeline and escalate to Secretary-level.",
        "Medium": "Schedule on-site inspector audit. Monitor monthly cash flow vs milestone deliverables. Flag for quarterly MIS review.",
        "Low": "Project progressing within permissible variance tolerance. Maintain standard MoSPI monthly reporting cycle.",
    }

    model_source = "xgboost_pkl"
    if not cost_model_used and not delay_model_used:
        model_source = "formula_fallback"
    elif not cost_model_used or not delay_model_used:
        model_source = "partial_xgboost"

    return MLPredictionResult(
        risk_score=risk_score,
        risk_level=risk_level,
        cost_overrun_prob=cost_overrun_prob,
        time_delay_prob=time_delay_prob,
        predicted_cost_overrun_cr=predicted_cost_overrun_cr,
        predicted_delay_months=predicted_delay_months,
        top_risk_factors=factors[:3],
        recommended_action=recommendations[risk_level],
        model_source=model_source,
        baseline_delay_months=round(baseline_delay, 1),
        dynamic_adjusted_delay_months=round(total_delay_months, 1),
        live_signals={
            "weather": weather,
            "commodities": commodity,
            "news_disruptions": news,
        },
        risk_badge=risk_badge,
    )


# ── Formula fallback (used when models can't load) ─────────────────────────────
def _formula_fallback(
    orig_cost: float,
    rev_cost: float,
    exp: float,
    progress: float,
    sector: str,
) -> MLPredictionResult:
    overrun_pct = max(0.0, ((rev_cost - orig_cost) / orig_cost) * 100) if orig_cost > 0 else 0
    exp_ratio = (exp / rev_cost * 100) if rev_cost > 0 else 0
    progress_lag = max(0.0, exp_ratio - progress)

    sector_weights = {
        "Transport & Logistics": 1.15,
        "Energy": 1.05,
        "Water & Sanitation": 1.10,
        "Social Infrastructure": 0.95,
        "Communication": 0.90,
    }
    weight = sector_weights.get(sector, 1.0)
    base_score = (overrun_pct * 0.4) + (progress_lag * 0.35) + ((100 - progress) * 0.15)
    raw_risk = min(98.0, max(12.0, base_score * weight + random.uniform(-4, 6)))
    risk_score = round(raw_risk, 1)

    cost_overrun_prob = round(min(0.96, max(0.08, (risk_score / 100) * 0.85 + (overrun_pct / 100) * 0.2)), 2)
    time_delay_prob = round(min(0.95, max(0.10, (1 - (progress / 100)) * 0.6 + (risk_score / 150))), 2)
    risk_level = "High" if risk_score >= 70 else ("Medium" if risk_score >= 45 else "Low")
    predicted_cost_overrun_cr = round(max(0.0, rev_cost - orig_cost + (rev_cost * (risk_score / 100) * 0.08)), 2)
    predicted_delay_months = int(max(0, round((time_delay_prob * 18) + (100 - progress) * 0.1)))

    factors = []
    if overrun_pct > 10:
        factors.append(f"Revised cost exceeds original budget by {overrun_pct:.1f}%")
    if progress_lag > 15:
        factors.append(f"Fund expenditure leads physical progress by {progress_lag:.1f}%")
    if progress < 40:
        factors.append("Early phase milestone delays identified")
    if sector in ["Transport & Logistics", "Water & Sanitation"]:
        factors.append(f"High historical volatility in {sector} sector")
    if not factors:
        factors.append("Project progress aligned with approved timeline and budget baseline")

    recommendations = {
        "High": "Mandatory MoSPI high-level steering committee review within 14 days. Re-baseline procurement timeline.",
        "Medium": "Schedule on-site inspector audit. Monitor monthly cash flow vs milestone deliverables.",
        "Low": "Project progressing within permissible variance tolerance. Maintain standard reporting.",
    }

    return MLPredictionResult(
        risk_score=risk_score,
        risk_level=risk_level,
        cost_overrun_prob=cost_overrun_prob,
        time_delay_prob=time_delay_prob,
        predicted_cost_overrun_cr=predicted_cost_overrun_cr,
        predicted_delay_months=predicted_delay_months,
        top_risk_factors=factors[:3],
        recommended_action=recommendations[risk_level],
        model_source="formula_fallback",
    )


# ── Convenience wrapper (used by seeding & create_project) ────────────────────
def calculate_ml_prediction(
    orig_cost: float,
    rev_cost: float,
    exp: float,
    progress: float,
    sector: str,
    ministry: str = "MoRTH",
    state: str = "Maharashtra",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> MLPredictionResult:
    return run_real_ml_prediction(
        orig_cost, rev_cost, exp, progress, sector,
        ministry, state, start_date, end_date,
    )


# ── DB helpers ─────────────────────────────────────────────────────────────────
def get_connection():
    connection = sqlite3.connect(DATABASE_PATH, timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 30000")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = FULL")
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or os.urandom(16)
    digest = pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"{base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        encoded_salt, encoded_digest = stored_hash.split("$", 1)
        salt = base64.b64decode(encoded_salt)
        expected_digest = base64.b64decode(encoded_digest)
        actual_digest = pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
        return compare_digest(actual_digest, expected_digest)
    except (ValueError, TypeError):
        return False


def project_from_row(row: sqlite3.Row) -> ProjectStat:
    return ProjectStat(**dict(row))


def insert_project(connection, project: ProjectStat) -> None:
    connection.execute(
        """
        INSERT INTO projects (
            id, name, sector, original_cost, revised_cost, expenditure, status,
            risk_score, cost_overrun_prob, time_delay_prob, ministry, agency,
            location, physical_progress, start_date, expected_end_date,
            approval_date, revised_completion_date, project_status, description,
            assigned_inspector, assigned_inspector_id, assigned_officer_id, inspection_notes, last_inspected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            project.id, project.name, project.sector, project.original_cost,
            project.revised_cost, project.expenditure, project.status,
            project.risk_score, project.cost_overrun_prob, project.time_delay_prob,
            project.ministry, project.agency, project.location, project.physical_progress,
            project.start_date, project.expected_end_date,
            project.approval_date, project.revised_completion_date, project.project_status,
            project.description,
            project.assigned_inspector or "Inspector Sharma",
            project.assigned_inspector_id,
            project.assigned_officer_id or project.assigned_inspector_id,
            project.inspection_notes or "",
            project.last_inspected_at,
        ),
    )


def create_high_risk_notifications(connection, project: sqlite3.Row | ProjectStat) -> None:
    """Create one durable alert per recipient/project, even across page refreshes."""
    project_id = project["id"] if isinstance(project, sqlite3.Row) else project.id
    project_name = project["name"] if isinstance(project, sqlite3.Row) else project.name
    assigned_officer_id = (
        project["assigned_officer_id"] if isinstance(project, sqlite3.Row)
        else project.assigned_officer_id
    )
    if not assigned_officer_id:
        return

    officer = connection.execute(
        "SELECT name FROM users WHERE id = ? AND role = 'inspector'",
        (assigned_officer_id,),
    ).fetchone()
    if not officer:
        return
    admins = connection.execute("SELECT id, name FROM users WHERE role = 'admin'").fetchall()
    recipients = [(assigned_officer_id, f"⚠️ HIGH RISK: Project {project_name} assigned to you requires inspection.")]
    recipients.extend(
        (admin["id"], f"⚠️ HIGH RISK: Project {project_name} under Officer {officer['name']} requires attention.")
        for admin in admins
    )
    for user_id, message in recipients:
        connection.execute(
            """
            INSERT OR IGNORE INTO notifications
                (user_id, project_id, message, alert_type)
            VALUES (?, ?, ?, 'HIGH_RISK')
            """,
            (user_id, project_id, message),
        )


def normalize_project_assignment(connection, project_id: str) -> None:
    """Keep legacy assignment columns and the canonical officer ID synchronized."""
    connection.execute(
        """
        UPDATE projects
        SET assigned_officer_id = assigned_inspector_id
        WHERE id = ? AND assigned_officer_id IS NULL
        """,
        (project_id,),
    )




# ── Database initialisation ────────────────────────────────────────────────────
def initialize_database() -> None:
    with closing(get_connection()) as connection:
        # Existing databases may still have the original role constraint.
        users_schema = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).fetchone()
        if users_schema and "'inspector'" not in (users_schema[0] or '').lower():
            connection.execute("PRAGMA foreign_keys=off;")
            connection.execute(
                """
                CREATE TABLE users_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    role TEXT NOT NULL CHECK (role IN ('admin', 'inspector', 'user')),
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_seen_at TEXT,
                    UNIQUE(name, role)
                );
                """
            )
            user_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(users)").fetchall()
            }
            last_seen_expression = "last_seen_at" if "last_seen_at" in user_columns else "NULL"
            connection.execute(
                f"""
                INSERT INTO users_new (id, name, role, password_hash, created_at, last_seen_at)
                SELECT id, name, role, password_hash, created_at, {last_seen_expression}
                FROM users;
                """
            )
            connection.execute("DROP TABLE users;")
            connection.execute("ALTER TABLE users_new RENAME TO users;")
            connection.execute("PRAGMA foreign_keys=on;")
            connection.commit()

        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'inspector', 'user')),
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at TEXT,
                UNIQUE(name, role)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_unique
            ON users (LOWER(name));

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sector TEXT NOT NULL,
                original_cost REAL NOT NULL,
                revised_cost REAL NOT NULL,
                expenditure REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                risk_score REAL NOT NULL,
                cost_overrun_prob REAL NOT NULL,
                time_delay_prob REAL NOT NULL,
                ministry TEXT,
                agency TEXT,
                location TEXT,
                physical_progress REAL NOT NULL DEFAULT 0,
                start_date TEXT,
                expected_end_date TEXT,
                approval_date TEXT,
                revised_completion_date TEXT,
                project_status TEXT DEFAULT 'Ongoing',
                description TEXT NOT NULL DEFAULT '',
                assigned_inspector TEXT DEFAULT 'Inspector Sharma',
                assigned_inspector_id INTEGER,
                assigned_officer_id INTEGER,
                inspection_notes TEXT DEFAULT '',
                last_inspected_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                project_id TEXT NOT NULL,
                message TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                read_at TEXT,
                UNIQUE(user_id, project_id, alert_type),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            """
        )

        users = [
            ("Administrator", "admin"),
            ("Inspector Sharma", "inspector"),
            ("Inspector Rajesh Patel", "inspector"),
            ("Operations User", "user"),
            ("Citizen User", "user"),
        ]
        for name, role in users:
            connection.execute(
                "INSERT OR IGNORE INTO users (name, role, password_hash) VALUES (?, ?, ?)",
                (name, role, hash_password("admin")),
            )
        connection.commit()

        # ── Migrate existing databases: add new columns if missing ─────────
        migration_columns = [
            ("users", "last_seen_at", "TEXT"),
            ("projects", "approval_date", "TEXT"),
            ("projects", "revised_completion_date", "TEXT"),
            ("projects", "project_status", "TEXT DEFAULT 'Ongoing'"),
            ("projects", "assigned_inspector", "TEXT DEFAULT 'Inspector Sharma'"),
            ("projects", "assigned_inspector_id", "INTEGER"),
            ("projects", "assigned_officer_id", "INTEGER"),
            ("projects", "inspection_notes", "TEXT DEFAULT ''"),
            ("projects", "last_inspected_at", "TEXT"),
        ]
        for table, col, col_type in migration_columns:
            try:
                connection.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                connection.commit()
                logging.info(f"Migration: added column {col} to {table}")
            except Exception:
                pass  # Column already exists

        # Set default assigned inspector for existing projects where NULL or empty
        try:
            connection.execute("UPDATE projects SET assigned_inspector = 'Inspector Sharma' WHERE assigned_inspector IS NULL OR assigned_inspector = ''")
            connection.execute("UPDATE projects SET assigned_officer_id = assigned_inspector_id WHERE assigned_officer_id IS NULL")
            connection.commit()
        except Exception:
            pass


initialize_database()


# ── API Routes ─────────────────────────────────────────────────────────────────
@app.get("/", tags=["Health"])
async def root():
    models_status = {
        "cost_overrun_model": "loaded" if cost_model is not None else "unavailable",
        "delay_model": "loaded" if delay_model is not None else "unavailable",
        "ml_packages": "available" if ML_AVAILABLE else "not installed",
    }
    return {
        "portal": "MoSPI Infrastructure Project Monitoring & ML Risk Assessment System",
        "division": "Infrastructure and Project Monitoring Division (IPMD)",
        "ministry": "Ministry of Statistics and Programme Implementation, Government of India",
        "status": "OPERATIONAL",
        "models": models_status,
        "version": "2.4.0",
    }


@app.post("/api/v1/auth/login", response_model=UserResponse, tags=["Authentication"])
async def login(data: LoginInput):
    requested_name = data.name.strip()
    lookup_name = requested_name
    if requested_name.lower() == "admin" and data.role == "admin":
        lookup_name = "Administrator"
    elif requested_name.lower() == "user" and data.role == "user":
        lookup_name = "Operations User"

    with closing(get_connection()) as connection:
        user = connection.execute(
            "SELECT id, name, role, password_hash FROM users WHERE lower(name) = lower(?) AND role = ?",
            (lookup_name, data.role),
        ).fetchone()

    if user is None or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid role, name, or password")

    if user["role"] == "inspector":
        with closing(get_connection()) as connection:
            connection.execute(
                "UPDATE users SET last_seen_at = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), user["id"]),
            )
            connection.commit()

    return UserResponse(id=user["id"], name=user["name"], role=user["role"])


@app.post("/api/v1/auth/register", response_model=UserResponse, tags=["Authentication"])
async def register(data: RegisterInput):
    """
    Register a new administrator, inspector officer, or user account directly in the database.
    """
    name = data.name.strip()
    role = data.role.strip().lower()
    if role not in ("admin", "inspector", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin', 'inspector', or 'user'")
    if not name:
        raise HTTPException(status_code=400, detail="Full name cannot be blank")
    if len(data.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    with closing(get_connection()) as connection:
        existing = connection.execute(
            "SELECT id, role FROM users WHERE lower(name) = lower(?)",
            (name,),
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Account name '{name}' is already in use by a {existing['role']} account. Please choose a unique name.",
            )

        hashed = hash_password(data.password)
        cursor = connection.execute(
            "INSERT INTO users (name, role, password_hash) VALUES (?, ?, ?)",
            (name, role, hashed),
        )
        user_id = cursor.lastrowid
        connection.commit()

    return UserResponse(id=user_id, name=name, role=role)


@app.get("/api/v1/users", response_model=List[UserItem], tags=["User Management"])
async def list_users(_user: sqlite3.Row = Depends(require_role("admin"))):
    """Retrieve all users and administrators stored in the SQLite database."""
    with closing(get_connection()) as connection:
        rows = connection.execute(
            "SELECT id, name, role, created_at FROM users ORDER BY role ASC, id ASC"
        ).fetchall()
    return [
        UserItem(
            id=r["id"],
            name=r["name"],
            role=r["role"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


@app.post("/api/v1/users", response_model=UserResponse, tags=["User Management"])
async def create_user_by_admin(data: RegisterInput, _user: sqlite3.Row = Depends(require_role("admin"))):
    """Admin endpoint to create user/admin accounts in the database."""
    return await register(data)


@app.delete("/api/v1/users/{user_id}", tags=["User Management"])
async def delete_user(user_id: int, _user: sqlite3.Row = Depends(require_role("admin"))):
    """Delete a user/admin account from the SQLite database."""
    with closing(get_connection()) as connection:
        user = connection.execute("SELECT id, name, role FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Protect default Administrator account
        if user["name"] == "Administrator" and user["role"] == "admin":
            raise HTTPException(status_code=400, detail="Cannot delete default system Administrator account")

        connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        connection.commit()

    return {"message": f"User '{user['name']}' deleted successfully", "id": user_id}


@app.get("/api/v1/database/stats", response_model=DatabaseStats, tags=["Database"])
async def get_database_stats():
    """Returns real-time SQLite database statistics for users and projects."""
    size_bytes = DATABASE_PATH.stat().st_size if DATABASE_PATH.exists() else 0
    with closing(get_connection()) as connection:
        total_projects = connection.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
        total_users = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        total_admins = connection.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'").fetchone()[0]
        total_regular_users = connection.execute("SELECT COUNT(*) FROM users WHERE role = 'user'").fetchone()[0]
        total_inspectors = connection.execute("SELECT COUNT(*) FROM users WHERE role = 'inspector'").fetchone()[0]

    return DatabaseStats(
        database_file=DATABASE_PATH.name,
        database_size_bytes=size_bytes,
        total_projects=total_projects,
        total_users=total_users,
        total_admins=total_admins,
        total_regular_users=total_regular_users,
        total_inspectors=total_inspectors,
        status="connected",
    )


@app.get("/api/v1/inspectors", tags=["User Management"])
async def list_inspectors(_user: sqlite3.Row = Depends(require_role("admin"))):
    """Retrieve Inspector Officers who are currently active for assignment."""
    online_since = (datetime.utcnow() - timedelta(minutes=5)).isoformat()
    with closing(get_connection()) as connection:
        rows = connection.execute(
            """
            SELECT id, name, role, created_at, last_seen_at
            FROM users
            WHERE role = 'inspector' AND last_seen_at >= ?
            ORDER BY name ASC
            """,
            (online_since,),
        ).fetchall()
    return [
        UserItem(id=r["id"], name=r["name"], role=r["role"], created_at=r["created_at"], last_seen_at=r["last_seen_at"], is_online=True)
        for r in rows
    ]


@app.post("/api/v1/auth/heartbeat", tags=["Authentication"])
async def auth_heartbeat(user: sqlite3.Row = Depends(require_role("inspector"))):
    with closing(get_connection()) as connection:
        connection.execute(
            "UPDATE users SET last_seen_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), user["id"]),
        )
        connection.commit()
    return {"status": "online", "last_seen_at": datetime.utcnow().isoformat()}


@app.get("/api/v1/notifications", response_model=List[NotificationItem], tags=["Notifications"])
async def list_notifications(user: sqlite3.Row = Depends(get_current_user)):
    with closing(get_connection()) as connection:
        rows = connection.execute(
            """
            SELECT n.id, n.user_id, n.project_id, p.name AS project_name,
                   n.message, n.alert_type, n.created_at, n.read_at
            FROM notifications n
            JOIN projects p ON p.id = n.project_id
            WHERE n.user_id = ?
            ORDER BY n.created_at DESC, n.id DESC
            LIMIT 100
            """,
            (user["id"],),
        ).fetchall()
    return [NotificationItem(**dict(row)) for row in rows]


@app.patch("/api/v1/notifications/{notification_id}/read", response_model=NotificationItem, tags=["Notifications"])
async def mark_notification_read(
    notification_id: int,
    user: sqlite3.Row = Depends(get_current_user),
):
    with closing(get_connection()) as connection:
        connection.execute(
            "UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?",
            (datetime.utcnow().isoformat(), notification_id, user["id"]),
        )
        connection.commit()
        row = connection.execute(
            """
            SELECT n.id, n.user_id, n.project_id, p.name AS project_name,
                   n.message, n.alert_type, n.created_at, n.read_at
            FROM notifications n JOIN projects p ON p.id = n.project_id
            WHERE n.id = ? AND n.user_id = ?
            """,
            (notification_id, user["id"]),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    return NotificationItem(**dict(row))


@app.get("/api/v1/analytics/overview", response_model=DashboardOverview, tags=["Analytics"])
async def get_dashboard_overview(user: Optional[sqlite3.Row] = Depends(get_optional_user)):
    with closing(get_connection()) as connection:
        scope = " WHERE assigned_officer_id = ?" if user and user["role"] == "inspector" else ""
        scope_params = [user["id"]] if scope else []
        summary = connection.execute(
            f"""
            SELECT COUNT(*) AS total_projects,
                   COALESCE(SUM(original_cost), 0) AS total_original_cost,
                   COALESCE(SUM(revised_cost), 0) AS total_revised_cost,
                   COALESCE(SUM(expenditure), 0) AS total_expenditure,
                   COALESCE(SUM(CASE WHEN risk_score > 75 THEN 1 ELSE 0 END), 0) AS high_risk_projects,
                   COALESCE(SUM(CASE WHEN risk_score > 80 OR time_delay_prob > 0.7 THEN 1 ELSE 0 END), 0) AS critical_alerts
            FROM projects{scope}
            """,
            scope_params,
        ).fetchone()

    return DashboardOverview(
        total_projects=summary["total_projects"],
        total_original_cost=round(summary["total_original_cost"], 2),
        total_revised_cost=round(summary["total_revised_cost"], 2),
        total_expenditure=round(summary["total_expenditure"], 2),
        high_risk_projects=summary["high_risk_projects"],
        critical_alerts=summary["critical_alerts"],
    )


@app.get("/api/v1/projects", response_model=List[ProjectStat], tags=["Projects"])
async def get_projects(
    limit: int = 200,
    state: Optional[str] = None,
    sector: Optional[str] = None,
    inspector: Optional[str] = None,
    user: Optional[sqlite3.Row] = Depends(get_optional_user),
):
    """Get all projects. Optionally filter by state, sector, and assigned inspector."""
    limit = max(1, min(limit, 1000))
    query = "SELECT * FROM projects WHERE 1=1"
    params: list = []
    if user and user["role"] == "inspector":
        query += " AND assigned_officer_id = ?"
        params.append(user["id"])
    if state and state.lower() != "all":
        query += " AND lower(location) = lower(?)"
        params.append(state)
    if sector and sector.lower() != "all":
        query += " AND lower(sector) = lower(?)"
        params.append(sector)
    if inspector and inspector.lower() != "all":
        query += " AND lower(assigned_inspector) = lower(?)"
        params.append(inspector)
    query += " ORDER BY risk_score DESC LIMIT ?"
    params.append(limit)
    with closing(get_connection()) as connection:
        rows = connection.execute(query, params).fetchall()
    return [project_from_row(row) for row in rows]


@app.get("/api/v1/projects/{project_id}", response_model=ProjectStat, tags=["Projects"])
async def get_project(project_id: str, user: Optional[sqlite3.Row] = Depends(get_optional_user)):
    """Retrieve a single project from the database."""
    with closing(get_connection()) as connection:
        row = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        if user and user["role"] == "inspector" and row["assigned_officer_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="This project is not assigned to you")
        return project_from_row(row)


@app.delete("/api/v1/projects/{project_id}", tags=["Projects"])
async def delete_project(project_id: str, _user: sqlite3.Row = Depends(require_role("admin"))):
    """Delete a project from the SQLite database."""
    with closing(get_connection()) as connection:
        existing = connection.execute("SELECT id, name FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Project not found")
        connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        connection.commit()
    return {"message": f"Project {project_id} deleted successfully", "id": project_id}


@app.patch("/api/v1/projects/{project_id}/status", response_model=ProjectStat, tags=["Projects"])
async def update_project_status(
    project_id: str,
    data: UpdateProjectStatusInput,
    user: sqlite3.Row = Depends(require_role("admin", "inspector")),
):
    """
    Inspector Officer endpoint: update project status, physical progress, completion date, and inspection notes.
    Also allows Admin to update the assigned_inspector field.
    """
    with closing(get_connection()) as connection:
        row = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        if user["role"] == "inspector":
            is_assigned = (
                row["assigned_officer_id"] == user["id"]
                or row["assigned_inspector_id"] == user["id"]
                or (row["assigned_inspector"] or "").lower() == user["name"].lower()
            )
            if not is_assigned:
                raise HTTPException(status_code=403, detail="This project is not assigned to you")
            if data.assigned_inspector is not None:
                raise HTTPException(status_code=403, detail="Inspectors cannot reassign projects")

        fields, values = [], []
        if data.status is not None:
            fields.append("status = ?")
            values.append(data.status)
        if data.project_status is not None:
            fields.append("project_status = ?")
            values.append(data.project_status)
        if data.physical_progress is not None:
            fields.append("physical_progress = ?")
            values.append(data.physical_progress)
        if data.revised_completion_date is not None:
            fields.append("revised_completion_date = ?")
            values.append(data.revised_completion_date)
        if data.inspection_notes is not None:
            fields.append("inspection_notes = ?")
            values.append(data.inspection_notes)
            fields.append("last_inspected_at = ?")
            values.append(datetime.utcnow().isoformat())
        if data.assigned_inspector is not None:
            fields.append("assigned_inspector = ?")
            values.append(data.assigned_inspector)

        if fields:
            values.append(project_id)
            connection.execute(f"UPDATE projects SET {', '.join(fields)} WHERE id = ?", values)
            connection.commit()

        updated = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return project_from_row(updated)


@app.patch("/api/v1/projects/{project_id}/assign", response_model=ProjectStat, tags=["Projects"])
async def assign_project_inspector(
    project_id: str,
    data: AssignInspectorInput,
    _user: sqlite3.Row = Depends(require_role("admin")),
):
    """Admin endpoint: assign or reassign an Inspector Officer as project in-charge."""
    with closing(get_connection()) as connection:
        row = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        inspector_id = data.assigned_officer_id or data.assigned_inspector_id
        if not inspector_id:
            raise HTTPException(status_code=400, detail="An Inspector Officer is required")
        inspector = connection.execute(
                        """
                        SELECT id, name FROM users
                        WHERE id = ? AND role = 'inspector'
                            AND last_seen_at >= ?
                        """,
                        (inspector_id, (datetime.utcnow() - timedelta(minutes=5)).isoformat()),
        ).fetchone()
        if not inspector:
                        raise HTTPException(status_code=400, detail="Selected officer is not currently logged in")
        connection.execute(
            "UPDATE projects SET assigned_inspector = ?, assigned_inspector_id = ? WHERE id = ?",
            (data.assigned_inspector or inspector["name"], inspector_id, project_id)
        )
        connection.execute(
            "UPDATE projects SET assigned_officer_id = ? WHERE id = ?",
            (inspector_id, project_id),
        )
        connection.commit()
        updated = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if updated["risk_score"] >= 70:
            create_high_risk_notifications(connection, updated)
            connection.commit()
        return project_from_row(updated)




@app.post("/api/v1/projects", response_model=ProjectStat, tags=["Projects"])
async def create_project(data: CreateProjectInput, _user: sqlite3.Row = Depends(require_role("admin"))):
    expenditure = data.expenditure or 0.0
    progress = data.physical_progress or 0.0
    ministry = data.ministry or "MoRTH"
    state = data.location or "Maharashtra"

    prediction = calculate_ml_prediction(
        data.original_cost, data.revised_cost, expenditure, progress,
        data.sector, ministry, state, data.start_date, data.expected_end_date,
    )
    status = (
        "At Risk" if prediction.risk_score > 70
        else ("Delayed" if prediction.time_delay_prob > 0.6 else "Ongoing")
    )

    with closing(get_connection()) as connection:
        project_number = connection.execute("SELECT COUNT(*) + 1000 FROM projects").fetchone()[0]
        project = ProjectStat(
            id=f"PRJ-{project_number}",
            name=data.name,
            sector=data.sector,
            original_cost=data.original_cost,
            revised_cost=data.revised_cost,
            expenditure=expenditure,
            status=status,
            risk_score=prediction.risk_score,
            cost_overrun_prob=prediction.cost_overrun_prob,
            time_delay_prob=prediction.time_delay_prob,
            ministry=ministry,
            agency=data.agency,
            location=state,
            physical_progress=progress,
            start_date=data.start_date,
            expected_end_date=data.expected_end_date,
            approval_date=data.approval_date,
            revised_completion_date=data.revised_completion_date,
            project_status=data.project_status or "Ongoing",
            description=data.description,
        )
        project.assigned_inspector = data.assigned_inspector or project.assigned_inspector
        project.assigned_inspector_id = data.assigned_inspector_id
        project.assigned_officer_id = data.assigned_inspector_id
        insert_project(connection, project)
        created = connection.execute("SELECT * FROM projects WHERE id = ?", (project.id,)).fetchone()
        if created["risk_score"] >= 70:
            create_high_risk_notifications(connection, created)
        connection.commit()
    return project


@app.post("/api/v1/predictions/predict", response_model=MLPredictionResult, tags=["Predictions"])
async def run_ml_prediction(data: PredictInput):
    """
    Real-time ML risk prediction using the trained XGBoost pipelines.
    Accepts project parameters and returns cost overrun probability,
    delay forecast, and risk score derived from the .pkl models.
    """
    result = run_real_ml_prediction(
        orig_cost=data.original_cost,
        rev_cost=data.revised_cost,
        exp=data.expenditure or 0.0,
        progress=data.physical_progress or 0.0,
        sector=data.sector,
        ministry=data.ministry or "MoRTH",
        state=data.state or "Maharashtra",
        start_date=data.start_date,
        end_date=data.expected_end_date,
    )
    if data.project_id and result.risk_score >= 70:
        with closing(get_connection()) as connection:
            row = connection.execute("SELECT * FROM projects WHERE id = ?", (data.project_id,)).fetchone()
            if row:
                create_high_risk_notifications(connection, row)
                connection.commit()
    return result


@app.post("/predict", tags=["Predictions"])
async def predict_project_risk_direct(data: ProjectPayload):
    """
    Master Prediction Endpoint matching mospi_advanced_api.py / main (1).py
    Runs XGBoost Delay Baseline + Live Hindrances (Weather, Commodity, News).
    """
    input_dict = {
        'Ministry': data.ministry,
        'Sector': SECTOR_MAP.get(data.sector, data.sector),
        'State': data.state,
        'Original_Cost_Cr': data.original_cost_cr,
        'Cumulative_Expenditure_Cr': data.cumulative_expenditure_cr,
        'Physical_Progress_Pct': data.physical_progress_pct,
        'Progress_Velocity': data.progress_velocity,
        'Expenditure_Velocity_Cr': data.expenditure_velocity_cr,
        'Planned_Duration_Months': data.planned_duration_months
    }
    terrain = data.terrain_difficulty or _derive_terrain(data.state)
    if delay_model is not None and 'Terrain_Difficulty' in getattr(delay_model, 'feature_names_in_', ['Terrain_Difficulty']):
        input_dict['Terrain_Difficulty'] = terrain

    if delay_model is not None:
        try:
            baseline_delay = float(delay_model.predict(pd.DataFrame([input_dict]))[0])
            baseline_delay = max(0.0, baseline_delay)
        except Exception as e:
            logging.warning(f"Direct delay prediction error: {e}")
            baseline_delay = 2.5
    else:
        baseline_delay = 3.0

    weather = get_live_weather_risk(data.latitude or 25.6, data.longitude or 85.1)
    commodity = get_commodity_risk(data.sector)
    news = get_local_disruption_risk(data.state, data.sector)

    total_delay = baseline_delay + weather.get("delay_adder", 0.0) + commodity.get("delay_adder", 0.0) + news.get("delay_adder", 0.0)

    # Persist project to database if requested
    if getattr(data, 'save_to_db', False):
        try:
            with closing(get_connection()) as conn:
                pid = data.canonical_id or f"PRJ-{random.randint(3000, 9999)}"
                status = "At Risk" if total_delay > 12 else ("Delayed" if total_delay > 6 else "Ongoing")
                risk_score = round(min(98.0, max(12.0, total_delay * 4.5)), 1)
                cost_prob = round(min(0.95, max(0.1, (data.cumulative_expenditure_cr / (data.original_cost_cr + 1e-5)) * 0.8)), 2)
                delay_prob = round(min(0.95, max(0.05, total_delay / 24.0)), 2)
                insert_project(conn, ProjectStat(
                    id=pid,
                    name=f"{data.sector} Infrastructure ({data.state})",
                    sector=data.sector,
                    original_cost=data.original_cost_cr,
                    revised_cost=data.original_cost_cr,
                    expenditure=data.cumulative_expenditure_cr,
                    status=status,
                    risk_score=risk_score,
                    cost_overrun_prob=cost_prob,
                    time_delay_prob=delay_prob,
                    ministry=data.ministry,
                    agency="NHAI",
                    location=data.state,
                    physical_progress=data.physical_progress_pct,
                    start_date=None,
                    expected_end_date=None,
                    description=f"Auto-saved from /predict API. Live delay: {round(total_delay, 1)}m",
                ))
                conn.commit()
        except Exception as e:
            logging.warning(f"Could not persist project from /predict: {e}")

    return {
        "canonical_id": data.canonical_id or "PRJ-DEFAULT",
        "baseline_delay_months": round(baseline_delay, 1),
        "dynamic_adjusted_delay_months": round(total_delay, 1),
        "live_signals": {
            "weather": weather,
            "commodities": commodity,
            "news_disruptions": news
        },
        "risk_badge": "CRITICAL RISK" if total_delay > 24 else ("HIGH RISK" if total_delay > 12 else "ON TRACK")
    }


@app.get("/api/v1/predictions/alerts", tags=["Predictions"])
async def get_early_warning_alerts(user: Optional[sqlite3.Row] = Depends(get_optional_user)):
    with closing(get_connection()) as connection:
        scope = " AND assigned_officer_id = ?" if user and user["role"] == "inspector" else ""
        scope_params = [user["id"]] if scope else []
        rows = connection.execute(
            f"""
            SELECT id, name, cost_overrun_prob, time_delay_prob, risk_score
            FROM projects
            WHERE (risk_score > 80 OR time_delay_prob > 0.7){scope}
            ORDER BY risk_score DESC
            LIMIT 6
            """,
            scope_params,
        ).fetchall()

    alerts = []
    for project in rows:
        if project["risk_score"] > 80:
            alerts.append({
                "project_id": project["id"],
                "project_name": project["name"],
                "alert_type": "High Risk",
                "message": f"High probability of cost overrun ({int(project['cost_overrun_prob'] * 100)}%). Recommend immediate review.",
                "severity": "critical",
            })
        else:
            alerts.append({
                "project_id": project["id"],
                "project_name": project["name"],
                "alert_type": "Schedule Delay",
                "message": f"Project timeline at risk ({int(project['time_delay_prob'] * 100)}% probability of delay).",
                "severity": "warning",
            })
    return alerts


@app.get("/api/v1/predictions/model-status", tags=["Predictions"])
async def get_model_status():
    """Returns which ML models are loaded and available."""
    return {
        "ml_packages_available": ML_AVAILABLE,
        "cost_overrun_model": {
            "path": str(COST_MODEL_PATH),
            "loaded": cost_model is not None,
            "file_exists": COST_MODEL_PATH.exists(),
        },
        "delay_model": {
            "path": str(DELAY_MODEL_PATH),
            "loaded": delay_model is not None,
            "file_exists": DELAY_MODEL_PATH.exists(),
        },
    }
