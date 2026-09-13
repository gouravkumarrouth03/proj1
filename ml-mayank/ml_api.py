import os
import json
import logging
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Configure Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ml_api")

# Model and Config Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "risk_model_v2.joblib")
CONFIG_PATH = os.path.join(BASE_DIR, "feature_config_v2.json")

# Global Application State
ml_resources: Dict[str, Any] = {
    "model": None,
    "config": None,
    "feature_names": [],
    "threshold": 0.55,
}


def load_ml_resources():
    """Load ML model and feature configuration into memory."""
    if ml_resources["model"] is not None and ml_resources["config"] is not None:
        return

    logger.info("Loading ML prediction resources...")

    # 1. Load Feature Configuration
    if not os.path.exists(CONFIG_PATH):
        logger.error(f"Configuration file not found at: {CONFIG_PATH}")
        raise RuntimeError(f"Missing configuration file: {CONFIG_PATH}")
    
    try:
        with open(CONFIG_PATH, "r") as f:
            config = json.load(f)
        ml_resources["config"] = config
        ml_resources["feature_names"] = config.get("features", [])
        ml_resources["threshold"] = config.get("operational_decision_threshold", 0.55)
        logger.info(f"Loaded feature configuration ({len(ml_resources['feature_names'])} features, threshold: {ml_resources['threshold']})")
    except Exception as e:
        logger.error(f"Failed to parse configuration file: {e}")
        raise RuntimeError(f"Failed to load config: {e}")

    # 2. Load Frozen XGBoost Model
    if not os.path.exists(MODEL_PATH):
        logger.error(f"Model artifact not found at: {MODEL_PATH}")
        raise RuntimeError(f"Missing model artifact: {MODEL_PATH}")
    
    try:
        model = joblib.load(MODEL_PATH)
        ml_resources["model"] = model
        logger.info(f"Successfully loaded frozen model: {type(model).__name__} from {MODEL_PATH}")
    except Exception as e:
        logger.error(f"Failed to load model file: {e}")
        raise RuntimeError(f"Failed to load model: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown."""
    load_ml_resources()
    yield
    logger.info("Shutting down ML Prediction Service...")


# Initialize FastAPI Application
app = FastAPI(
    title="Infrastructure Risk Prediction API",
    description="Production-grade ML prediction service for SIH Infrastructure Monitoring & Risk Detection System.",
    version="2.0.0",
    lifespan=lifespan,
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Also ensure loaded on import for robust direct testing
try:
    load_ml_resources()
except Exception as err:
    logger.warning(f"Initial resource load deferred to lifespan: {err}")


# ==========================================
# PYDANTIC SCHEMAS
# ==========================================
class HealthResponse(BaseModel):
    status: str = "ok"
    model: str = "risk_model_v2"
    threshold: float = 0.55


class ProjectFeaturesInput(BaseModel):
    """Pydantic model validating all 21 exact features required by risk_model_v2."""
    physical_progress_pct: float = Field(..., ge=0.0, le=100.0, description="Current physical completion progress percentage (0-100)")
    progress_change_1m: float = Field(..., ge=-100.0, le=100.0, description="1-month progress increment percentage")
    progress_change_2m: float = Field(..., ge=-100.0, le=100.0, description="2-month cumulative progress increment percentage")
    recent_progress_stalled: int = Field(..., ge=0, le=1, description="Binary indicator: 1 if progress stalled/decreased in last month, else 0")
    is_first_report: int = Field(..., ge=0, le=1, description="Binary indicator: 1 if this is the project's first reported month, else 0")
    expenditure_ratio: float = Field(..., ge=0.0, description="Ratio of cumulative expenditure to revised cost")
    expenditure_change_1m: float = Field(..., ge=0.0, description="1-month expenditure change in Crore INR")
    cost_overrun_pct: float = Field(..., description="Cost overrun percentage: (revised - original) / original")
    cost_overrun_crore: float = Field(..., ge=0.0, description="Absolute cost overrun in Crore INR")
    progress_spend_divergence: float = Field(..., description="Divergence between spend ratio % and physical progress %")
    months_since_approval: float = Field(..., ge=0.0, description="Number of months elapsed since project sanction/approval")
    months_to_commissioning: float = Field(..., description="Remaining months to commissioning deadline (can be negative if overdue)")
    is_overdue: int = Field(..., ge=0, le=1, description="Binary indicator: 1 if project is past target commissioning date, else 0")
    schedule_delay_months: float = Field(..., ge=0.0, description="Schedule delay in months (anticipated - original)")
    required_monthly_velocity: float = Field(..., ge=0.0, description="Required monthly progress % to finish on time")
    velocity_gap: float = Field(..., description="Gap between required monthly velocity and actual recent progress velocity")
    log_revised_cost: float = Field(..., ge=0.0, description="Natural log (1 + revised cost in Crore)")
    log_expenditure: float = Field(..., ge=0.0, description="Natural log (1 + cumulative expenditure in Crore)")
    is_mega_project: int = Field(..., ge=0, le=1, description="Binary indicator: 1 if revised cost >= 1000 Crore, else 0")
    agency_freq: float = Field(..., ge=0.0, description="Agency frequency/capacity score")
    month_num: int = Field(..., ge=1, le=12, description="Month of year (1-12) capturing cyclical fiscal reporting")


class FeatureExplanation(BaseModel):
    feature: str
    contribution: float
    direction: str
    human_readable_reason: str


class PredictionResponse(BaseModel):
    risk_probability: float
    risk: bool
    risk_level: str
    threshold: float
    model_version: str = "v2"
    explanations: Optional[list[FeatureExplanation]] = []
    prescriptive_actions: Optional[list[str]] = []
    early_warning: Optional[bool] = False
    early_warning_message: Optional[str] = ""


def generate_human_readable_reason(feature: str, val: float, contrib: float) -> str:
    if feature == "recent_progress_stalled":
        return "Physical progress has stalled or made zero progress in the latest reporting period." if val == 1 else "Physical progress is actively advancing."
    elif feature == "velocity_gap":
        if val > 0:
            return f"Required monthly execution velocity exceeds actual progress rate by {val:.1f}%/month."
        return "Actual execution velocity is on track with required milestone rate."
    elif feature == "cost_overrun_pct":
        if val > 0:
            return f"Project cost has escalated by {val*100:.1f}% over original sanctioned budget."
        return "Project cost is within sanctioned budget."
    elif feature == "cost_overrun_crore":
        if val > 0:
            return f"Cost escalation of ₹{val:.2f} Crore recorded over initial estimate."
        return "No absolute cost overrun recorded."
    elif feature == "progress_spend_divergence":
        if val > 5.0:
            return f"Financial expenditure ratio exceeds physical execution progress by {val:.1f}%."
        elif val < -5.0:
            return f"Physical progress is outpacing financial disbursements by {abs(val):.1f}%."
        return "Financial spend is well synchronized with physical progress."
    elif feature == "is_overdue":
        return "Project is already overdue past scheduled commissioning date." if val == 1 else "Project is currently within active target completion timeline."
    elif feature == "schedule_delay_months":
        if val > 0:
            return f"Project schedule has slipped by {val:.1f} months against original timeline."
        return "Project timeline has no recorded schedule delay."
    elif feature == "months_to_commissioning":
        if val > 0:
            return f"{val:.1f} months remaining to target commissioning deadline."
        return f"Commissioning deadline has passed by {abs(val):.1f} months."
    elif feature == "required_monthly_velocity":
        return f"Requires {val:.1f}% monthly physical completion rate to finish on schedule."
    elif feature == "physical_progress_pct":
        return f"Cumulative physical completion is currently at {val:.1f}%."
    elif feature == "progress_change_1m":
        return f"Latest 1-month physical progress increment is {val:+.1f}%."
    elif feature == "progress_change_2m":
        return f"Cumulative 2-month physical progress increment is {val:+.1f}%."
    elif feature == "is_first_report":
        return "Project is in its first reporting snapshot period." if val == 1 else "Project has established historical tracking record."
    elif feature == "expenditure_ratio":
        return f"Cumulative financial expenditure stands at {val*100:.1f}% of revised budget."
    elif feature == "expenditure_change_1m":
        return f"Recent 1-month expenditure change was ₹{val:.2f} Crore."
    elif feature == "months_since_approval":
        return f"Project has been in execution for {val:.1f} months since approval."
    elif feature == "log_revised_cost":
        return f"Project revised financial scale (approx ₹{np.exp(val)-1:.1f} Cr)."
    elif feature == "log_expenditure":
        return f"Cumulative expenditure financial scale (approx ₹{np.exp(val)-1:.1f} Cr)."
    elif feature == "is_mega_project":
        return "Classified as Mega Project (revised budget >= ₹1,000 Crore)." if val == 1 else "Standard budget project scale (< ₹1,000 Crore)."
    elif feature == "agency_freq":
        return f"Implementing agency manages {int(val)} active monitored projects."
    elif feature == "month_num":
        return f"Reporting falls in fiscal monitoring cycle month {int(val)}."
    return f"{feature.replace('_', ' ').title()}: {val} (SHAP impact: {contrib:+.3f})"


def generate_prescriptive_actions(risk_level: str, input_dict: dict, top_features: list) -> list[str]:
    actions = []
    top_names = [f["feature"] for f in top_features]
    
    if "recent_progress_stalled" in top_names or input_dict.get("recent_progress_stalled", 0) == 1 or input_dict.get("velocity_gap", 0) > 5.0:
        actions.append("Investigate progress stagnation and mobilize additional contractor shifts to recover velocity gap.")
        
    if "progress_spend_divergence" in top_names or input_dict.get("progress_spend_divergence", 0) > 10.0:
        actions.append("Conduct an immediate audit of physical site deliverables before releasing pending milestone disbursements.")
        
    if "cost_overrun_pct" in top_names or "cost_overrun_crore" in top_names or input_dict.get("cost_overrun_pct", 0) > 0.10:
        actions.append("Review project budget escalation and audit vendor rate revisions with the financial committee.")
        
    if "is_overdue" in top_names or input_dict.get("is_overdue", 0) == 1 or input_dict.get("schedule_delay_months", 0) > 3.0:
        actions.append("Escalate project schedule to the inter-ministerial monitoring committee for right-of-way and statutory clearances.")
        
    if input_dict.get("is_mega_project", 0) == 1:
        actions.append("Increase monitoring frequency to bi-weekly executive review due to mega-project budget threshold.")
        
    if not actions:
        if risk_level == "HIGH":
            actions.append("Schedule expedited officer review to evaluate pending milestones and critical path dependencies.")
        elif risk_level == "MEDIUM":
            actions.append("Increase periodic monitoring frequency and review next milestone progress closely.")
        else:
            actions.append("Maintain standard periodic monitoring; project parameters are within acceptable bounds.")
            
    return actions[:3]


# ==========================================
# API ENDPOINTS
# ==========================================
@app.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
async def health_check():
    """Health check endpoint returning model status and current operational threshold."""
    if ml_resources["model"] is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model is not initialized or failed to load."
        )
    return HealthResponse(
        status="ok",
        model="risk_model_v2",
        threshold=ml_resources["threshold"]
    )


@app.post("/predict", response_model=PredictionResponse, status_code=status.HTTP_200_OK)
async def predict_risk(payload: ProjectFeaturesInput):
    """
    Accepts 21 validated project features, constructs the feature vector in exact model ordering,
    computes risk probability via XGBoost v2, extracts TreeSHAP feature contributions,
    and returns risk classification, explanations, prescriptive actions, and early warning status.
    """
    model = ml_resources["model"]
    feature_names = ml_resources["feature_names"]
    threshold = ml_resources["threshold"]

    if model is None or not feature_names:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Prediction model is not available. Check service logs."
        )

    try:
        import xgboost as xgb
        # Convert Pydantic model to dictionary
        input_dict = payload.model_dump()

        # Construct dataframe strictly matching the exact feature order of the trained model
        feature_vector = [input_dict[col] for col in feature_names]
        df_input = pd.DataFrame([feature_vector], columns=feature_names)

        # Run inference
        prob_array = model.predict_proba(df_input)
        risk_probability = float(prob_array[0, 1])

        # Apply operational decision threshold
        is_risk = bool(risk_probability >= threshold)

        # Determine Risk Level Category:
        if risk_probability < 0.40:
            risk_level = "LOW"
        elif risk_probability < threshold:
            risk_level = "MEDIUM"
        else:
            risk_level = "HIGH"

        # Compute TreeSHAP feature contributions
        booster = model.get_booster()
        dmat = xgb.DMatrix(df_input)
        contribs = booster.predict(dmat, pred_contribs=True)
        feat_contribs = contribs[0, :-1]

        # Select top 5 most important contributing features by absolute SHAP magnitude
        top_indices = np.argsort(np.abs(feat_contribs))[::-1][:5]
        explanations = []
        top_feature_dicts = []

        for idx in top_indices:
            feat_name = feature_names[idx]
            contrib_val = float(feat_contribs[idx])
            raw_val = float(feature_vector[idx])
            direction = "INCREASES_RISK" if contrib_val > 0 else "DECREASES_RISK"
            reason = generate_human_readable_reason(feat_name, raw_val, contrib_val)

            explanation_item = FeatureExplanation(
                feature=feat_name,
                contribution=round(contrib_val, 4),
                direction=direction,
                human_readable_reason=reason
            )
            explanations.append(explanation_item)
            top_feature_dicts.append({"feature": feat_name, "contribution": contrib_val, "direction": direction})

        # Generate prescriptive recommended actions
        prescriptive_actions = generate_prescriptive_actions(risk_level, input_dict, top_feature_dicts)

        # Determine Early Warning indicator
        is_overdue_val = int(input_dict.get("is_overdue", 0))
        progress_val = float(input_dict.get("physical_progress_pct", 0.0))

        if risk_probability >= 0.40 and is_overdue_val == 0 and progress_val < 100.0:
            early_warning = True
            early_warning_message = "Early Warning: Project is currently on schedule but exhibits leading indicators of impending delay or cost escalation."
        elif is_overdue_val == 1:
            early_warning = False
            early_warning_message = "Project is already overdue against scheduled commissioning date."
        else:
            early_warning = False
            early_warning_message = "No early warning flags detected; project parameters stable."

        return PredictionResponse(
            risk_probability=round(risk_probability, 4),
            risk=is_risk,
            risk_level=risk_level,
            threshold=threshold,
            model_version="v2",
            explanations=explanations,
            prescriptive_actions=prescriptive_actions,
            early_warning=early_warning,
            early_warning_message=early_warning_message,
        )

    except Exception as e:
        logger.exception("Prediction calculation error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference failed: {str(e)}"
        )

