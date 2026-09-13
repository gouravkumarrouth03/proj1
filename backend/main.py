from contextlib import closing
from hashlib import pbkdf2_hmac
from hmac import compare_digest
from pathlib import Path
import base64
import os
import random
import sqlite3
import logging
import json
import uuid
import re
import secrets
import smtplib
from email.message import EmailMessage

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass
from typing import List, Optional
from datetime import datetime, date, timedelta

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
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
COMMENT_UPLOADS_DIR = DATABASE_PATH.parent / "comment_uploads"
COMMENT_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR = Path(__file__).parent.parent  # project root where .pkl files live

MAYANK_MODEL_PATH = MODELS_DIR / "ml-mayank" / "risk_model_v2.joblib"
MAYANK_CONFIG_PATH = MODELS_DIR / "ml-mayank" / "feature_config_v2.json"

# ── Load trained models at startup ─────────────────────────────────────────────
cost_model = None
delay_model = None
mayank_model = None
mayank_config = None

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
        with MAYANK_CONFIG_PATH.open("r", encoding="utf-8") as config_file:
            mayank_config = json.load(config_file)
        mayank_model = joblib.load(MAYANK_MODEL_PATH)
        logging.info(f"✅ ML-MAYANK risk model loaded from {MAYANK_MODEL_PATH}")
    except Exception as e:
        logging.error(f"❌ Could not load ML-MAYANK risk model: {e}")
        mayank_model = None
        mayank_config = None

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
app.mount("/comment-uploads", StaticFiles(directory=COMMENT_UPLOADS_DIR), name="comment-uploads")


# ── Pydantic models ────────────────────────────────────────────────────────────
class LoginInput(BaseModel):
    role: str
    name: str
    password: str
    affiliation: Optional[str] = None


class RegisterInput(BaseModel):
    name: str
    role: str
    password: str
    email: Optional[str] = None
    affiliation: str = "Public"


class InviteOfficerInput(BaseModel):
    name: str
    email: str


class SendOtpInput(BaseModel):
    email: str


class VerifyOtpInput(BaseModel):
    email: str
    otp: str


class ChangePasswordInput(BaseModel):
    current_password: str
    new_password: str


class AccessRequestResponse(BaseModel):
    id: int
    user_id: int
    user_name: str
    user_email: Optional[str]
    affiliation: str
    status: str
    created_at: str
    resolved_at: Optional[str] = None
    resolved_by: Optional[int] = None


OTP_STORE: dict[str, tuple[str, datetime]] = {}
OTP_EXPIRY_MINUTES = 5


class UserResponse(BaseModel):
    id: int
    name: str
    role: str
    email: Optional[str] = None
    must_change_password: bool = False
    affiliation: str = "Public"


class UserItem(BaseModel):
    id: int
    name: str
    role: str
    email: Optional[str] = None
    affiliation: str = "Public"
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


class ProjectComment(BaseModel):
    id: int
    project_id: str
    comment: str
    image_url: str
    created_at: str


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


class ProjectHistoryItem(BaseModel):
    id: int
    project_id: str
    event_type: str
    changed_fields: List[str]
    snapshot: dict
    actor_id: Optional[int] = None
    actor_name: str
    actor_role: str
    recorded_at: str


class DeletedProjectBackup(BaseModel):
    id: int
    project_id: str
    project_name: str
    snapshot: dict
    deleted_at: str
    expires_at: str
    deleted_by: int
    deleted_by_name: str


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
    run_ml_prediction: bool = True


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


def normalize_affiliation(value: Optional[str]) -> str:
    aliases = {
        "central government": "Ministry of Central Govt",
        "ministry of central govt": "Ministry of Central Govt",
        "state government": "Ministry of State Govt",
        "ministry of state govt": "Ministry of State Govt",
        "public": "Public",
    }
    normalized = (value or "Public").strip().lower()
    if normalized not in aliases:
        raise HTTPException(status_code=400, detail="Affiliation must be Public, Central Government, or State Government")
    return aliases[normalized]


def normalize_state_key(value: Optional[str]) -> str:
    """Normalize state names so usernames such as 'westbengal' match 'West Bengal'."""
    return re.sub(r"[^a-z0-9]", "", (value or "").strip().lower())


def get_current_user(
    session_user_id: Optional[int] = Header(default=None, alias="X-User-ID"),
    user_role: Optional[str] = Header(default=None, alias="X-User-Role"),
) -> sqlite3.Row:
    """Resolve the signed-in account used by the role-aware portal actions."""
    if session_user_id is None or not user_role:
        raise HTTPException(status_code=401, detail="Authentication required")

    with closing(get_connection()) as connection:
        user = connection.execute(
            "SELECT id, name, role, affiliation FROM users WHERE id = ? AND role = ?",
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
            "SELECT id, name, role, affiliation FROM users WHERE id = ? AND role = ?",
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
def _months_between(start_value: Optional[str], end_value: Optional[str]) -> float:
    if not start_value or not end_value:
        return 0.0
    try:
        start = datetime.fromisoformat(str(start_value).replace("Z", "+00:00")).replace(tzinfo=None)
        end = datetime.fromisoformat(str(end_value).replace("Z", "+00:00")).replace(tzinfo=None)
        return max(0.0, (end - start).days / 30.4375)
    except (TypeError, ValueError):
        return 0.0


def _mayank_feature_values(
    orig_cost: float,
    rev_cost: float,
    exp: float,
    progress: float,
    agency: Optional[str],
    start_date: Optional[str],
    approval_date: Optional[str],
    end_date: Optional[str],
    project_id: Optional[str] = None,
) -> dict:
    defaults = (mayank_config or {}).get("default_fill_values", {})
    features = dict(defaults)
    history = []
    if project_id:
        try:
            with closing(get_connection()) as connection:
                history_rows = connection.execute(
                    "SELECT snapshot FROM project_update_history WHERE project_id = ? ORDER BY recorded_at ASC, id ASC",
                    (project_id,),
                ).fetchall()
            history = [json.loads(item["snapshot"]) for item in history_rows]
        except (sqlite3.Error, TypeError, ValueError, json.JSONDecodeError):
            history = []

    previous = history[-1] if history else None
    two_back = history[-2] if len(history) > 1 else None
    previous_progress = float(previous.get("physical_progress") or 0.0) if previous else progress
    two_back_progress = float(two_back.get("physical_progress") or 0.0) if two_back else previous_progress
    previous_exp = float(previous.get("expenditure") or 0.0) if previous else exp
    recent_change = progress - previous_progress if history else 0.0
    two_month_change = progress - two_back_progress if len(history) > 1 else recent_change
    expenditure_change = max(0.0, exp - previous_exp) if history else 0.0
    current_date = datetime.utcnow().date()
    months_since_approval = _months_between(approval_date, current_date.isoformat())
    months_to_commissioning = _months_between(current_date.isoformat(), end_date)
    schedule_delay_months = _months_between(end_date, start_date) if end_date and start_date and end_date < start_date else 0.0
    remaining_months = max(1.0, months_to_commissioning)
    actual_velocity = recent_change
    required_velocity = max(0.0, (100.0 - progress) / remaining_months)
    agency_frequency = 1.0
    try:
        with closing(get_connection()) as connection:
            agency_frequency = float(connection.execute(
                "SELECT COUNT(*) FROM projects WHERE lower(COALESCE(agency, '')) = lower(?)",
                (agency or "",),
            ).fetchone()[0] or 1)
    except sqlite3.Error:
        pass

    features.update({
        "physical_progress_pct": min(100.0, max(0.0, progress)),
        "progress_change_1m": max(-100.0, min(100.0, recent_change)),
        "progress_change_2m": max(-100.0, min(100.0, two_month_change)),
        "recent_progress_stalled": int(recent_change <= 0),
        "is_first_report": int(len(history) <= 1),
        "expenditure_ratio": max(0.0, exp / max(rev_cost, 1e-6)),
        "expenditure_change_1m": expenditure_change,
        "cost_overrun_pct": (rev_cost - orig_cost) / max(orig_cost, 1e-6),
        "cost_overrun_crore": max(0.0, rev_cost - orig_cost),
        "progress_spend_divergence": (exp / max(rev_cost, 1e-6) * 100.0) - progress,
        "months_since_approval": months_since_approval,
        "months_to_commissioning": months_to_commissioning,
        "is_overdue": int(months_to_commissioning == 0 and end_date is not None),
        "schedule_delay_months": schedule_delay_months,
        "required_monthly_velocity": required_velocity,
        "velocity_gap": required_velocity - actual_velocity,
        "log_revised_cost": float(np.log1p(max(0.0, rev_cost))),
        "log_expenditure": float(np.log1p(max(0.0, exp))),
        "is_mega_project": int(rev_cost >= 1000),
        "agency_freq": agency_frequency,
        "month_num": current_date.month,
    })
    return {feature: features.get(feature, 0.0) for feature in (mayank_config or {}).get("features", features.keys())}


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
    project_id: Optional[str] = None,
    approval_date: Optional[str] = None,
    agency: Optional[str] = None,
) -> MLPredictionResult:
    """
    Run inference using the two trained XGBoost pipelines.
    Falls back to formula if models are unavailable.
    """
    if not ML_AVAILABLE or mayank_model is None or mayank_config is None:
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

    mayank_probability = None
    mayank_values = {}
    if mayank_model is not None and mayank_config:
        try:
            mayank_values = _mayank_feature_values(
                orig_cost, rev_cost, exp, progress, agency, start_date,
                approval_date, end_date, project_id,
            )
            mayank_features = (mayank_config.get("features") or list(mayank_values.keys()))
            mayank_frame = pd.DataFrame([[mayank_values[name] for name in mayank_features]], columns=mayank_features)
            mayank_probability = float(mayank_model.predict_proba(mayank_frame)[0, 1])
            cost_signal = min(1.0, max(0.0, mayank_values.get("cost_overrun_pct", 0.0) * 5.0))
            spend_signal = min(1.0, max(0.0, mayank_values.get("progress_spend_divergence", 0.0) / 50.0))
            cost_overrun_prob = round(min(0.95, max(0.02, (
                (mayank_probability * 0.50) + (cost_signal * 0.35) + (spend_signal * 0.15)
            ))), 2)

            overdue_signal = float(mayank_values.get("is_overdue", 0))
            velocity_signal = min(1.0, max(0.0, mayank_values.get("velocity_gap", 0.0) / 10.0))
            schedule_signal = min(1.0, max(0.0, mayank_values.get("schedule_delay_months", 0.0) / 12.0))
            time_delay_prob = round(min(0.95, max(0.05, (
                (mayank_probability * 0.50) + (overdue_signal * 0.25) +
                (velocity_signal * 0.15) + (schedule_signal * 0.10)
            ))), 2)
        except Exception as exc:
            logging.warning(f"ML-MAYANK inference failed: {exc}. Using legacy blended risk.")

    # ML-MAYANK is the primary risk classifier; legacy models retain cost/delay metrics.
    raw_risk = (mayank_probability * 100) if mayank_probability is not None else ((cost_overrun_prob * 55) + (time_delay_prob * 45))
    risk_score = round(min(98.0, max(8.0, raw_risk)), 1)

    mayank_threshold = float((mayank_config or {}).get("operational_decision_threshold", 0.55))
    risk_level = "High" if (mayank_probability is not None and mayank_probability >= mayank_threshold) or risk_score >= 70 else ("Medium" if risk_score >= 45 else "Low")
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

    model_source = "ml_mayank_only" if mayank_probability is not None else "formula_fallback"
    if mayank_probability is None and not cost_model_used and not delay_model_used:
        model_source = "formula_fallback"

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
    project_id: Optional[str] = None,
    approval_date: Optional[str] = None,
    agency: Optional[str] = None,
) -> MLPredictionResult:
    return run_real_ml_prediction(
        orig_cost, rev_cost, exp, progress, sector,
        ministry, state, start_date, end_date, project_id, approval_date, agency,
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


def validate_email(email: str) -> str:
    normalized = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
        raise HTTPException(status_code=400, detail="Enter a valid officer email address")
    return normalized


def send_invitation_email(email: str, name: str, password: str) -> bool:
    host = os.getenv("SMTP_HOST")
    if not host:
        logging.warning("SMTP_HOST is not configured; invitation credentials generated for %s", email)
        return False

    message = EmailMessage()
    message["Subject"] = "MoSPI Infrastructure Portal officer credentials"
    message["From"] = os.getenv("SMTP_FROM", os.getenv("SMTP_USER", "noreply@mospi.gov.in"))
    message["To"] = email
    message.set_content(
        f"Dear {name},\n\n"
        "An Inspector Officer account has been created for the MoSPI Infrastructure Monitoring Portal.\n\n"
        f"Username: {email}\nTemporary password: {password}\n\n"
        "Please sign in and change your password immediately.\n"
    )
    port = int(os.getenv("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=15) as server:
        server.starttls()
        username = os.getenv("SMTP_USER")
        if username:
            server.login(username, re.sub(r"\s+", "", os.getenv("SMTP_PASSWORD", "")))
        server.send_message(message)
    return True


def send_otp_email(email: str, otp: str) -> bool:
    host = os.getenv("SMTP_HOST")
    if not host:
        return False
    message = EmailMessage()
    message["Subject"] = "MoSPI officer email verification OTP"
    message["From"] = os.getenv("SMTP_FROM", os.getenv("SMTP_USER", "noreply@mospi.gov.in"))
    message["To"] = email
    message.set_content(
        "Your MoSPI officer email verification code is "
        f"{otp}. It expires in {OTP_EXPIRY_MINUTES} minutes."
    )
    with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=15) as server:
        server.starttls()
        username = os.getenv("SMTP_USER")
        if username:
            server.login(username, re.sub(r"\s+", "", os.getenv("SMTP_PASSWORD", "")))
        server.send_message(message)
    return True


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


def record_project_history(
    connection,
    project_row: sqlite3.Row,
    event_type: str,
    changed_fields: List[str],
    actor: Optional[sqlite3.Row],
    recorded_at: Optional[str] = None,
) -> None:
    """Persist a complete post-change snapshot for the project timeline."""
    connection.execute(
        """
        INSERT INTO project_update_history
            (project_id, event_type, changed_fields, snapshot, actor_id, actor_name, actor_role, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        """,
        (
            project_row["id"],
            event_type,
            json.dumps(changed_fields),
            json.dumps(dict(project_row), default=str),
            actor["id"] if actor else None,
            actor["name"] if actor else "System",
            actor["role"] if actor else "system",
            recorded_at,
        ),
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
        # Migration for affiliation column
        try:
            connection.execute("ALTER TABLE users ADD COLUMN affiliation TEXT DEFAULT 'Public'")
            connection.commit()
            logging.info("Migration: added affiliation column to users")
        except Exception:
            pass

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
                    email TEXT,
                    affiliation TEXT DEFAULT 'Public',
                    must_change_password INTEGER NOT NULL DEFAULT 0,
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
            affiliation_expression = "affiliation" if "affiliation" in user_columns else "'Public'"
            connection.execute(
                f"""
                INSERT INTO users_new (id, name, role, password_hash, email, affiliation, must_change_password, created_at, last_seen_at)
                SELECT id, name, role, password_hash, NULL, {affiliation_expression}, 0, created_at, {last_seen_expression}
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
                email TEXT,
                affiliation TEXT DEFAULT 'Public',
                must_change_password INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at TEXT,
                UNIQUE(name, role)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_unique
            ON users (LOWER(name));

            CREATE TABLE IF NOT EXISTS access_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                resolved_at TEXT,
                resolved_by INTEGER,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(resolved_by) REFERENCES users(id)
            );


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

            CREATE TABLE IF NOT EXISTS project_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                comment TEXT NOT NULL,
                image_filename TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS project_update_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                changed_fields TEXT NOT NULL DEFAULT '[]',
                snapshot TEXT NOT NULL,
                actor_id INTEGER,
                actor_name TEXT NOT NULL,
                actor_role TEXT NOT NULL,
                recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_project_history_project_time
            ON project_update_history(project_id, recorded_at DESC, id DESC);

            CREATE TABLE IF NOT EXISTS deleted_project_backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                project_name TEXT NOT NULL,
                snapshot TEXT NOT NULL,
                deleted_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                deleted_by INTEGER NOT NULL,
                deleted_by_name TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_deleted_project_backups_expiry
            ON deleted_project_backups(expires_at);
            """
        )

        existing_projects = connection.execute(
            """
            SELECT p.* FROM projects p
            WHERE NOT EXISTS (
                SELECT 1 FROM project_update_history h WHERE h.project_id = p.id
            )
            """
        ).fetchall()
        for project_row in existing_projects:
            record_project_history(
                connection,
                project_row,
                "project_baseline",
                list(dict(project_row).keys()),
                None,
                project_row["start_date"] or project_row["created_at"],
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
            ("users", "email", "TEXT"),
            ("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0"),
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
        "ml_mayank_risk_model": "loaded" if mayank_model is not None else "unavailable",
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
                        """
                        SELECT id, name, role, email, password_hash, must_change_password, affiliation
                        FROM users
                        WHERE (lower(name) = lower(?) OR lower(email) = lower(?))
                            AND (
                                role = ?
                                OR (
                                    ? = 'user'
                                    AND role = 'admin'
                                    AND affiliation IN ('Ministry of Central Govt', 'Ministry of State Govt')
                                )
                            )
                        """,
                        (lookup_name, lookup_name, data.role, data.role.strip().lower()),
        ).fetchone()

    if user is None or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid role, name, or password")
    if data.role.strip().lower() == "user" and normalize_affiliation(data.affiliation) != normalize_affiliation(user["affiliation"]):
        raise HTTPException(status_code=401, detail="Selected affiliation does not match this account")

    if user["role"] == "inspector":
        with closing(get_connection()) as connection:
            connection.execute(
                "UPDATE users SET last_seen_at = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), user["id"]),
            )
            connection.commit()

    return UserResponse(
        id=user["id"], name=user["name"], role=user["role"], email=user["email"],
        must_change_password=bool(user["must_change_password"]),
        affiliation=dict(user).get("affiliation", "Public"),
    )


@app.post("/api/v1/auth/register", response_model=UserResponse, tags=["Authentication"])
async def register(data: RegisterInput):
    """
    Register a new administrator, inspector officer, or user account directly in the database.
    """
    name = data.name.strip()
    role = data.role.strip().lower()
    if role not in ("admin", "inspector", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin', 'inspector', or 'user'")
    # Ministry-affiliated users must register as 'user' and request admin via the approval flow
    affiliation = normalize_affiliation(data.affiliation)
    if affiliation in ("Ministry of Central Govt", "Ministry of State Govt") and role == "admin":
        raise HTTPException(
            status_code=403,
            detail="Ministry personnel cannot directly register as Admin. Please register as a User and request admin access from your dashboard.",
        )
    if not name:
        raise HTTPException(status_code=400, detail="Full name cannot be blank")
    if len(data.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    email = validate_email(data.email) if data.email else None

    with closing(get_connection()) as connection:
        existing = connection.execute(
            "SELECT id, role FROM users WHERE lower(name) = lower(?) OR (? IS NOT NULL AND lower(email) = lower(?))",
            (name, email, email),
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Account name '{name}' is already in use by a {existing['role']} account. Please choose a unique name.",
            )

        hashed = hash_password(data.password)
        cursor = connection.execute(
            "INSERT INTO users (name, role, password_hash, email, affiliation) VALUES (?, ?, ?, ?, ?)",
            (name, role, hashed, email, affiliation),
        )
        user_id = cursor.lastrowid
        connection.commit()

    return UserResponse(id=user_id, name=name, role=role, email=email, affiliation=affiliation)


@app.post("/api/v1/auth/change-password", response_model=UserResponse, tags=["Authentication"])
async def change_password(data: ChangePasswordInput, user: sqlite3.Row = Depends(get_current_user)):
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    with closing(get_connection()) as connection:
        current = connection.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not current or not verify_password(data.current_password, current["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
        connection.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
            (hash_password(data.new_password), user["id"]),
        )
        connection.commit()
        updated = connection.execute("SELECT id, name, role, email, must_change_password FROM users WHERE id = ?", (user["id"],)).fetchone()
    return UserResponse(id=updated["id"], name=updated["name"], role=updated["role"], email=updated["email"], must_change_password=False)


@app.get("/api/v1/auth/me", response_model=UserResponse, tags=["Authentication"])
async def current_user(
    session_user_id: Optional[int] = Header(default=None, alias="X-User-ID"),
):
    if session_user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    with closing(get_connection()) as connection:
        user = connection.execute(
            "SELECT id, name, role, email, must_change_password, affiliation FROM users WHERE id = ?",
            (session_user_id,),
        ).fetchone()
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid user session")
    return UserResponse(
        id=user["id"], name=user["name"], role=user["role"], email=user["email"],
        must_change_password=bool(user["must_change_password"]),
        affiliation=normalize_affiliation(user["affiliation"]),
    )


@app.get("/api/v1/users", response_model=List[UserItem], tags=["User Management"])
async def list_users(_user: sqlite3.Row = Depends(require_role("admin"))):
    """Retrieve all users and administrators stored in the SQLite database."""
    with closing(get_connection()) as connection:
        rows = connection.execute(
            "SELECT id, name, role, email, created_at FROM users ORDER BY role ASC, id ASC"
        ).fetchall()
    return [
        UserItem(
            id=r["id"],
            name=r["name"],
            role=r["role"],
            email=r["email"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


@app.post("/api/v1/users", response_model=UserResponse, tags=["User Management"])
async def create_user_by_admin(data: RegisterInput, _user: sqlite3.Row = Depends(require_role("admin"))):
    """Admin endpoint to create user/admin accounts in the database."""
    return await register(data)


@app.post("/api/v1/users/invite-officer", tags=["User Management"])
async def invite_officer(data: InviteOfficerInput, _user: sqlite3.Row = Depends(require_role("admin"))):
    name = data.name.strip()
    email = validate_email(data.email)
    if not name:
        raise HTTPException(status_code=400, detail="Officer name cannot be blank")
    temporary_password = secrets.token_urlsafe(10)
    try:
        email_sent = send_invitation_email(email, name, temporary_password)
    except Exception as exc:
        logging.exception("Could not send officer invitation to %s", email)
        raise HTTPException(status_code=502, detail=f"Could not send invitation email: {exc}") from exc
    if not email_sent:
        raise HTTPException(
            status_code=503,
            detail="Email delivery is not configured. Set SMTP_HOST and SMTP credentials, then try again.",
        )

    with closing(get_connection()) as connection:
        existing = connection.execute(
            "SELECT id FROM users WHERE lower(name) = lower(?) OR lower(email) = lower(?)",
            (name, email),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="An account with this name or email already exists")
        cursor = connection.execute(
            "INSERT INTO users (name, role, password_hash, email, must_change_password) VALUES (?, 'inspector', ?, ?, 1)",
            (name, hash_password(temporary_password), email),
        )
        user_id = cursor.lastrowid
        connection.commit()
    return {
        "user": UserResponse(id=user_id, name=name, role="inspector", email=email, must_change_password=True),
        "email_sent": True,
    }


@app.post("/send-otp", tags=["Authentication"])
@app.post("/api/v1/send-otp", tags=["Authentication"])
async def send_otp(data: SendOtpInput, _user: sqlite3.Row = Depends(require_role("admin"))):
    email = validate_email(data.email)
    otp = f"{secrets.randbelow(1_000_000):06d}"
    try:
        if not send_otp_email(email, otp):
            raise HTTPException(status_code=503, detail="Email delivery is not configured")
    except HTTPException:
        raise
    except smtplib.SMTPAuthenticationError as exc:
        raise HTTPException(
            status_code=502,
            detail="Gmail rejected SMTP credentials. Enable 2-Step Verification and use a fresh 16-character Gmail App Password in SMTP_PASSWORD.",
        ) from exc
    except Exception as exc:
        logging.exception("Could not send OTP to %s", email)
        raise HTTPException(status_code=502, detail=f"Could not send verification email: {exc}") from exc
    OTP_STORE[email] = (otp, datetime.utcnow() + timedelta(minutes=OTP_EXPIRY_MINUTES))
    return {"message": "Verification code sent", "expires_in_seconds": OTP_EXPIRY_MINUTES * 60}


@app.post("/verify-otp", tags=["Authentication"])
@app.post("/api/v1/verify-otp", tags=["Authentication"])
async def verify_otp(data: VerifyOtpInput, _user: sqlite3.Row = Depends(require_role("admin"))):
    email = validate_email(data.email)
    stored = OTP_STORE.get(email)
    if not stored:
        raise HTTPException(status_code=400, detail="No active verification code. Request a new OTP.")
    expected_otp, expires_at = stored
    if datetime.utcnow() >= expires_at:
        OTP_STORE.pop(email, None)
        raise HTTPException(status_code=400, detail="Verification code has expired. Request a new OTP.")
    if not compare_digest(expected_otp, data.otp.strip()):
        raise HTTPException(status_code=400, detail="Incorrect verification code")
    OTP_STORE.pop(email, None)
    return {"verified": True, "email": email}


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
    """Retrieve all database inspectors and flag currently signed-in officers."""
    online_since = (datetime.utcnow() - timedelta(minutes=5)).isoformat()
    with closing(get_connection()) as connection:
        rows = connection.execute(
            """
            SELECT id, name, role, email, created_at, last_seen_at
            FROM users
            WHERE role = 'inspector'
            ORDER BY name ASC
            """
        ).fetchall()
    return [
        UserItem(
            id=r["id"],
            name=r["name"],
            role=r["role"],
            email=r["email"],
            created_at=r["created_at"],
            last_seen_at=r["last_seen_at"],
            is_online=bool(r["last_seen_at"] and r["last_seen_at"] >= online_since),
        )
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
    if user and normalize_affiliation(user["affiliation"]) == "Ministry of State Govt":
        state_key = normalize_state_key(user["name"])
        query += " AND lower(replace(replace(location, ' ', ''), '-', '')) = ?"
        params.append(state_key)
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
        if user and normalize_affiliation(user["affiliation"]) == "Ministry of State Govt":
            if normalize_state_key(row["location"]) != normalize_state_key(user["name"]):
                raise HTTPException(status_code=403, detail="This project is outside your State Government scope")
        return project_from_row(row)


@app.get("/api/v1/projects/{project_id}/history", response_model=List[ProjectHistoryItem], tags=["Project History"])
async def get_project_history(
    project_id: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user: sqlite3.Row = Depends(require_role("admin", "inspector")),
):
    """Return complete project snapshots, optionally constrained by recorded date."""
    try:
        if from_date:
            date.fromisoformat(from_date)
        if to_date:
            date.fromisoformat(to_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="History dates must use YYYY-MM-DD format") from exc

    with closing(get_connection()) as connection:
        project = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if user["role"] == "inspector":
            is_assigned = (
                project["assigned_officer_id"] == user["id"]
                or project["assigned_inspector_id"] == user["id"]
                or (project["assigned_inspector"] or "").lower() == user["name"].lower()
            )
            if not is_assigned:
                raise HTTPException(status_code=403, detail="This project is not assigned to you")
        if normalize_affiliation(user["affiliation"]) == "Ministry of State Govt":
            if normalize_state_key(project["location"]) != normalize_state_key(user["name"]):
                raise HTTPException(status_code=403, detail="This project is outside your State Government scope")

        clauses = ["project_id = ?"]
        params = [project_id]
        if from_date:
            clauses.append("recorded_at >= ?")
            params.append(f"{from_date} 00:00:00")
        if to_date:
            clauses.append("recorded_at <= ?")
            params.append(f"{to_date} 23:59:59")
        rows = connection.execute(
            f"SELECT * FROM project_update_history WHERE {' AND '.join(clauses)} ORDER BY recorded_at DESC, id DESC",
            params,
        ).fetchall()

    return [
        ProjectHistoryItem(
            id=row["id"],
            project_id=row["project_id"],
            event_type=row["event_type"],
            changed_fields=json.loads(row["changed_fields"] or "[]"),
            snapshot=json.loads(row["snapshot"] or "{}"),
            actor_id=row["actor_id"],
            actor_name=row["actor_name"],
            actor_role=row["actor_role"],
            recorded_at=row["recorded_at"],
        )
        for row in rows
    ]


@app.get("/api/v1/projects/{project_id}/comments", response_model=List[ProjectComment], tags=["Project Comments"])
async def list_project_comments(project_id: str):
    with closing(get_connection()) as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        rows = connection.execute(
            "SELECT id, project_id, comment, image_filename, created_at FROM project_comments WHERE project_id = ? ORDER BY created_at DESC, id DESC",
            (project_id,),
        ).fetchall()
    return [
        ProjectComment(
            id=row["id"],
            project_id=row["project_id"],
            comment=row["comment"],
            image_url=f"/comment-uploads/{row['image_filename']}",
            created_at=row["created_at"],
        )
        for row in rows
    ]


@app.post("/api/v1/projects/{project_id}/comments", response_model=ProjectComment, tags=["Project Comments"])
async def add_project_comment(
    project_id: str,
    comment: str = Form(...),
    image: UploadFile = File(...),
    _user: sqlite3.Row = Depends(require_role("user")),
):
    """Accept an anonymous public comment with a mandatory evidence image."""
    text = comment.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload a valid image")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="An image is required")
    if len(image_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be 5 MB or smaller")

    extension = Path(image.filename or "image").suffix.lower()
    if extension not in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
        extension = ".jpg" if image.content_type == "image/jpeg" else ".png"
    stored_name = f"{uuid.uuid4().hex}{extension}"
    stored_path = COMMENT_UPLOADS_DIR / stored_name

    with closing(get_connection()) as connection:
        project = connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        stored_path.write_bytes(image_bytes)
        cursor = connection.execute(
            "INSERT INTO project_comments (project_id, comment, image_filename) VALUES (?, ?, ?)",
            (project_id, text, stored_name),
        )
        connection.commit()
        row = connection.execute(
            "SELECT id, project_id, comment, image_filename, created_at FROM project_comments WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()

    return ProjectComment(
        id=row["id"],
        project_id=row["project_id"],
        comment=row["comment"],
        image_url=f"/comment-uploads/{row['image_filename']}",
        created_at=row["created_at"],
    )


@app.delete("/api/v1/projects/{project_id}", tags=["Projects"])
async def delete_project(project_id: str, _user: sqlite3.Row = Depends(require_role("admin"))):
    """Delete a project and retain an Admin-only recovery backup for 30 days."""
    with closing(get_connection()) as connection:
        existing = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Project not found")
        deleted_at = datetime.utcnow()
        expires_at = deleted_at + timedelta(days=30)
        connection.execute(
            """
            INSERT INTO deleted_project_backups
                (project_id, project_name, snapshot, deleted_at, expires_at, deleted_by, deleted_by_name)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                existing["id"], existing["name"], json.dumps(dict(existing), default=str),
                deleted_at.isoformat(), expires_at.isoformat(), _user["id"], _user["name"],
            ),
        )
        connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        connection.commit()
    return {
        "message": f"Project {project_id} deleted successfully. Backup retained for 30 days.",
        "id": project_id,
        "backup_expires_at": expires_at.isoformat(),
    }


def cleanup_expired_project_backups(connection) -> None:
    connection.execute(
        "DELETE FROM deleted_project_backups WHERE expires_at <= ?",
        (datetime.utcnow().isoformat(),),
    )


@app.get("/api/v1/admin/project-backups", response_model=List[DeletedProjectBackup], tags=["Admin"])
async def list_project_backups(_user: sqlite3.Row = Depends(require_role("admin"))):
    with closing(get_connection()) as connection:
        cleanup_expired_project_backups(connection)
        rows = connection.execute(
            "SELECT * FROM deleted_project_backups ORDER BY deleted_at DESC, id DESC"
        ).fetchall()
        connection.commit()
    return [
        DeletedProjectBackup(
            id=row["id"], project_id=row["project_id"], project_name=row["project_name"],
            snapshot=json.loads(row["snapshot"]), deleted_at=row["deleted_at"],
            expires_at=row["expires_at"], deleted_by=row["deleted_by"],
            deleted_by_name=row["deleted_by_name"],
        )
        for row in rows
    ]


@app.post("/api/v1/admin/project-backups/{backup_id}/restore", tags=["Admin"])
async def restore_project_backup(backup_id: int, _user: sqlite3.Row = Depends(require_role("admin"))):
    with closing(get_connection()) as connection:
        cleanup_expired_project_backups(connection)
        backup = connection.execute(
            "SELECT * FROM deleted_project_backups WHERE id = ?",
            (backup_id,),
        ).fetchone()
        if not backup:
            raise HTTPException(status_code=404, detail="Backup not found or its 30-day retention period expired")
        if connection.execute("SELECT 1 FROM projects WHERE id = ?", (backup["project_id"],)).fetchone():
            raise HTTPException(status_code=409, detail="A project with this ID already exists")
        snapshot = json.loads(backup["snapshot"])
        allowed = {field for field in ProjectStat.model_fields if field in snapshot}
        restored = ProjectStat(**{field: snapshot[field] for field in allowed})
        insert_project(connection, restored)
        restored_row = connection.execute("SELECT * FROM projects WHERE id = ?", (restored.id,)).fetchone()
        record_project_history(connection, restored_row, "project_restored", list(snapshot.keys()), _user)
        connection.execute("DELETE FROM deleted_project_backups WHERE id = ?", (backup_id,))
        connection.commit()
    return {"message": f"Project {restored.id} restored successfully", "project": project_from_row(restored_row)}


@app.delete("/api/v1/admin/project-backups/{backup_id}", tags=["Admin"])
async def permanently_delete_project_backup(backup_id: int, _user: sqlite3.Row = Depends(require_role("admin"))):
    with closing(get_connection()) as connection:
        cleanup_expired_project_backups(connection)
        deleted = connection.execute("DELETE FROM deleted_project_backups WHERE id = ?", (backup_id,))
        if deleted.rowcount == 0:
            raise HTTPException(status_code=404, detail="Backup not found or its 30-day retention period expired")
        connection.commit()
    return {"message": "Backup permanently deleted"}


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
                or not row["assigned_inspector"]
                or (row["assigned_inspector"] or "").lower() in ("unassigned", "none", "")
            )
            if not is_assigned:
                raise HTTPException(status_code=403, detail="This project is not assigned to you")
            if data.assigned_inspector is not None:
                raise HTTPException(status_code=403, detail="Inspectors cannot reassign projects")

        fields, values, changed_fields = [], [], []
        if data.status is not None:
            fields.append("status = ?")
            values.append(data.status)
            changed_fields.append("status")
        if data.project_status is not None:
            fields.append("project_status = ?")
            values.append(data.project_status)
            changed_fields.append("project_status")
        if data.physical_progress is not None:
            fields.append("physical_progress = ?")
            values.append(data.physical_progress)
            changed_fields.append("physical_progress")
        if data.revised_completion_date is not None:
            fields.append("revised_completion_date = ?")
            values.append(data.revised_completion_date)
            changed_fields.append("revised_completion_date")
        if data.inspection_notes is not None:
            fields.append("inspection_notes = ?")
            values.append(data.inspection_notes)
            fields.append("last_inspected_at = ?")
            values.append(datetime.utcnow().isoformat())
            changed_fields.extend(["inspection_notes", "last_inspected_at"])
        if data.assigned_inspector is not None:
            fields.append("assigned_inspector = ?")
            values.append(data.assigned_inspector)
            changed_fields.append("assigned_inspector")

        ml_pred = None
        if data.run_ml_prediction:
            # Recalculate ML prediction on the revised data.
            prog = data.physical_progress if data.physical_progress is not None else (row["physical_progress"] or 0.0)
            end_d = data.revised_completion_date or row["revised_completion_date"] or row["expected_end_date"]
            ml_pred = calculate_ml_prediction(
                orig_cost=row["original_cost"],
                rev_cost=row["revised_cost"],
                exp=row["expenditure"] or 0.0,
                progress=prog,
                sector=row["sector"],
                ministry=row["ministry"] or "MoRTH",
                state=row["location"] or "Maharashtra",
                start_date=row["start_date"],
                end_date=end_d,
                project_id=project_id,
                approval_date=row["approval_date"],
                agency=row["agency"],
            )
            fields.append("risk_score = ?")
            values.append(ml_pred.risk_score)
            changed_fields.append("risk_score")
            fields.append("cost_overrun_prob = ?")
            values.append(ml_pred.cost_overrun_prob)
            changed_fields.append("cost_overrun_prob")
            fields.append("time_delay_prob = ?")
            values.append(ml_pred.time_delay_prob)
            changed_fields.append("time_delay_prob")

        if fields:
            values.append(project_id)
            connection.execute(f"UPDATE projects SET {', '.join(fields)} WHERE id = ?", values)

        updated = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if fields:
            record_project_history(connection, updated, "project_update", changed_fields, user)
        if ml_pred and ml_pred.risk_score >= 70:
            create_high_risk_notifications(connection, updated)
        connection.commit()

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
        updated = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        record_project_history(
            connection,
            updated,
            "inspector_assigned",
            ["assigned_inspector", "assigned_inspector_id", "assigned_officer_id"],
            _user,
        )
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
        approval_date=data.approval_date,
        agency=data.agency,
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
        record_project_history(
            connection,
            created,
            "project_created",
            list(dict(created).keys()),
            None,
            created["start_date"] or created["created_at"],
        )
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


class RepredictInput(BaseModel):
    """Optional overrides: pass revised values from the inspector update form so the ML
    pipeline can evaluate what the scores will look like *after* saving the update."""
    revised_cost: Optional[float] = None
    expenditure: Optional[float] = None
    physical_progress: Optional[float] = None
    revised_completion_date: Optional[str] = None


@app.post("/api/v1/projects/{project_id}/repredict", response_model=MLPredictionResult, tags=["Predictions"])
async def repredict_project(
    project_id: str,
    data: RepredictInput,
    user: sqlite3.Row = Depends(require_role("admin", "inspector")),
):
    """
    Re-run the full XGBoost ML prediction pipeline for a single project using its
    current (or inspector-revised) field values. Persists updated risk_score,
    cost_overrun_prob, time_delay_prob, and status back to the database.
    Returns the full MLPredictionResult so the UI can show inline results.
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
                or not row["assigned_inspector"]
                or (row["assigned_inspector"] or "").lower() in ("unassigned", "none", "")
            )
            if not is_assigned:
                raise HTTPException(status_code=403, detail="This project is not assigned to you")

        # Merge caller-supplied overrides with stored values
        orig_cost = row["original_cost"]
        rev_cost = data.revised_cost if data.revised_cost is not None else row["revised_cost"]
        exp = data.expenditure if data.expenditure is not None else (row["expenditure"] or 0.0)
        progress = data.physical_progress if data.physical_progress is not None else (row["physical_progress"] or 0.0)
        sector = row["sector"]
        ministry = row["ministry"] or "MoRTH"
        state = row["location"] or "Maharashtra"
        start_date = row["start_date"]
        # Use revised_completion_date as the end date when available
        end_date = data.revised_completion_date or row["revised_completion_date"] or row["expected_end_date"]

        prediction = calculate_ml_prediction(
            orig_cost=orig_cost,
            rev_cost=rev_cost,
            exp=exp,
            progress=progress,
            sector=sector,
            ministry=ministry,
            state=state,
            start_date=start_date,
            end_date=end_date,
            project_id=project_id,
            approval_date=row["approval_date"],
            agency=row["agency"],
        )

        new_status = (
            "At Risk" if prediction.risk_score > 70
            else ("Delayed" if prediction.time_delay_prob > 0.6 else "Ongoing")
        )

        connection.execute(
            """
            UPDATE projects
            SET risk_score = ?,
                cost_overrun_prob = ?,
                time_delay_prob = ?,
                status = ?
            WHERE id = ?
            """,
            (
                prediction.risk_score,
                prediction.cost_overrun_prob,
                prediction.time_delay_prob,
                new_status,
                project_id,
            ),
        )

        if prediction.risk_score >= 70:
            refreshed_row = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            create_high_risk_notifications(connection, refreshed_row)

        connection.commit()

    return prediction


@app.post("/api/v1/predictions/refresh", tags=["Predictions"])
async def refresh_all_predictions(
    _user: sqlite3.Row = Depends(require_role("admin", "inspector")),
):
    """
    Re-run the ML prediction pipeline for every project stored in the database
    and persist the updated risk_score, cost_overrun_prob, and time_delay_prob.
    Does NOT modify any ML model code – it simply calls the existing
    calculate_ml_prediction helper for each project row.
    """
    updated_count = 0
    errors = []

    with closing(get_connection()) as connection:
        rows = connection.execute("SELECT * FROM projects").fetchall()

        for row in rows:
            try:
                prediction = calculate_ml_prediction(
                    orig_cost=row["original_cost"],
                    rev_cost=row["revised_cost"],
                    exp=row["expenditure"] or 0.0,
                    progress=row["physical_progress"] or 0.0,
                    sector=row["sector"],
                    ministry=row["ministry"] or "MoRTH",
                    state=row["location"] or "Maharashtra",
                    start_date=row["start_date"],
                    end_date=row["expected_end_date"],
                    project_id=row["id"],
                    approval_date=row["approval_date"],
                    agency=row["agency"],
                )

                new_status = (
                    "At Risk" if prediction.risk_score > 70
                    else ("Delayed" if prediction.time_delay_prob > 0.6 else "Ongoing")
                )

                connection.execute(
                    """
                    UPDATE projects
                    SET risk_score = ?,
                        cost_overrun_prob = ?,
                        time_delay_prob = ?,
                        status = ?
                    WHERE id = ?
                    """,
                    (
                        prediction.risk_score,
                        prediction.cost_overrun_prob,
                        prediction.time_delay_prob,
                        new_status,
                        row["id"],
                    ),
                )
                updated_count += 1

                # Re-create high-risk notifications if score crosses threshold
                if prediction.risk_score >= 70:
                    refreshed_row = connection.execute(
                        "SELECT * FROM projects WHERE id = ?", (row["id"],)
                    ).fetchone()
                    create_high_risk_notifications(connection, refreshed_row)

            except Exception as exc:
                errors.append({"project_id": row["id"], "error": str(exc)})
                logging.warning(f"Refresh failed for project {row['id']}: {exc}")

        connection.commit()

    return {
        "message": f"ML model refresh complete. {updated_count} projects updated.",
        "updated": updated_count,
        "errors": errors,
    }


@app.post("/api/v1/inspector/repredict-assigned", tags=["Predictions"])
async def repredict_inspector_assigned_projects(
    user: sqlite3.Row = Depends(require_role("inspector", "admin")),
):
    """
    Inspector Section Endpoint: Re-run the full XGBoost ML pipeline for all projects
    assigned to the calling inspector officer. Recalculates risk_score, cost_overrun_prob,
    and time_delay_prob based on currently recorded field inspection values.
    """
    with closing(get_connection()) as connection:
        if user["role"] == "admin":
            rows = connection.execute("SELECT * FROM projects").fetchall()
        else:
            rows = connection.execute(
                """SELECT * FROM projects 
                   WHERE assigned_officer_id = ? 
                      OR assigned_inspector_id = ? 
                      OR lower(assigned_inspector) = lower(?)""",
                (user["id"], user["id"], user["name"]),
            ).fetchall()

        updated_count = 0
        for row in rows:
            try:
                prediction = calculate_ml_prediction(
                    orig_cost=row["original_cost"],
                    rev_cost=row["revised_cost"],
                    exp=row["expenditure"] or 0.0,
                    progress=row["physical_progress"] or 0.0,
                    sector=row["sector"],
                    ministry=row["ministry"] or "MoRTH",
                    state=row["location"] or "Maharashtra",
                    start_date=row["start_date"],
                    end_date=row["revised_completion_date"] or row["expected_end_date"],
                    project_id=row["id"],
                    approval_date=row["approval_date"],
                    agency=row["agency"],
                )
                new_status = (
                    "At Risk" if prediction.risk_score > 70
                    else ("Delayed" if prediction.time_delay_prob > 0.6 else "Ongoing")
                )
                connection.execute(
                    """
                    UPDATE projects
                    SET risk_score = ?,
                        cost_overrun_prob = ?,
                        time_delay_prob = ?,
                        status = ?
                    WHERE id = ?
                    """,
                    (
                        prediction.risk_score,
                        prediction.cost_overrun_prob,
                        prediction.time_delay_prob,
                        new_status,
                        row["id"],
                    ),
                )
                if prediction.risk_score >= 70:
                    refreshed = connection.execute("SELECT * FROM projects WHERE id = ?", (row["id"],)).fetchone()
                    create_high_risk_notifications(connection, refreshed)
                updated_count += 1
            except Exception as e:
                logging.warning(f"Inspector repredict failed for project {row['id']}: {e}")

        connection.commit()

    return {
        "message": f"Successfully re-predicted ML risk metrics for {updated_count} projects",
        "updated_count": updated_count,
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
        "ml_mayank_risk_model": {
            "path": str(MAYANK_MODEL_PATH),
            "loaded": mayank_model is not None,
            "file_exists": MAYANK_MODEL_PATH.exists(),
            "features": (mayank_config or {}).get("features", []),
            "threshold": (mayank_config or {}).get("operational_decision_threshold"),
        },
    }

@app.post("/api/v1/users/request-admin", tags=["Users"])
async def request_admin_access(user: sqlite3.Row = Depends(get_current_user)):
    affiliation = normalize_affiliation(dict(user).get("affiliation"))
    if user["role"] != "user":
        raise HTTPException(status_code=403, detail="Only Viewer accounts can request Admin access.")
    if affiliation not in ["Ministry of Central Govt", "Ministry of State Govt"]:
        raise HTTPException(status_code=403, detail="Only Ministry personnel can request Admin access.")
    
    with closing(get_connection()) as connection:
        existing = connection.execute("SELECT id FROM access_requests WHERE user_id = ? AND status = 'pending'", (user["id"],)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="You already have a pending admin access request.")
        
        connection.execute("INSERT INTO access_requests (user_id) VALUES (?)", (user["id"],))
        connection.commit()
    
    return {"message": "Admin access request submitted successfully."}

@app.get("/api/v1/admin/access-requests", response_model=List[AccessRequestResponse], tags=["Admin"])
async def list_access_requests(_user: sqlite3.Row = Depends(require_role("admin"))):
    with closing(get_connection()) as connection:
        rows = connection.execute('''
            SELECT a.id, a.user_id, a.status, a.created_at, a.resolved_at, a.resolved_by,
                   u.name as user_name, u.email as user_email, u.affiliation
            FROM access_requests a
            JOIN users u ON a.user_id = u.id
            ORDER BY a.created_at DESC
        ''').fetchall()
    
    return [AccessRequestResponse(**dict(r)) for r in rows]

@app.post("/api/v1/admin/access-requests/{request_id}/approve", tags=["Admin"])
async def approve_access_request(request_id: int, user: sqlite3.Row = Depends(require_role("admin"))):
    with closing(get_connection()) as connection:
        req = connection.execute(
            """
            SELECT a.user_id, a.status, u.role, u.affiliation
            FROM access_requests a JOIN users u ON u.id = a.user_id
            WHERE a.id = ?
            """,
            (request_id,),
        ).fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found.")
        if req["status"] != "pending":
            raise HTTPException(status_code=400, detail=f"Request is already {req['status']}.")
        if req["role"] != "user" or normalize_affiliation(req["affiliation"]) not in ["Ministry of Central Govt", "Ministry of State Govt"]:
            raise HTTPException(status_code=400, detail="Only eligible Viewer requests can be approved.")
        
        connection.execute("UPDATE access_requests SET status = 'approved', resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ?", (user["id"], request_id))
        connection.execute("UPDATE users SET role = 'admin' WHERE id = ?", (req["user_id"],))
        connection.commit()
    
    return {"message": "Request approved. User is now an admin."}

@app.post("/api/v1/admin/access-requests/{request_id}/reject", tags=["Admin"])
async def reject_access_request(request_id: int, user: sqlite3.Row = Depends(require_role("admin"))):
    with closing(get_connection()) as connection:
        req = connection.execute("SELECT status FROM access_requests WHERE id = ?", (request_id,)).fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found.")
        if req["status"] != "pending":
            raise HTTPException(status_code=400, detail=f"Request is already {req['status']}.")
        
        connection.execute("UPDATE access_requests SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ?", (user["id"], request_id))
        connection.commit()
    
    return {"message": "Request rejected."}

