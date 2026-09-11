from fastapi import FastAPI
from pydantic import BaseModel
import joblib
import pandas as pd
import requests

app = FastAPI(title="MoSPI Early Warning System API")

MODEL_PATH = "/content/drive/MyDrive/xgboost_delay_model_enhanced.pkl"
# If you used the original model, change to: "/content/drive/MyDrive/xgboost_delay_model.pkl"
model = joblib.load(MODEL_PATH)

class ProjectPayload(BaseModel):
    canonical_id: str
    ministry: str
    sector: str
    state: str
    terrain_difficulty: str = "Medium"
    original_cost_cr: float
    cumulative_expenditure_cr: float
    physical_progress_pct: float
    progress_velocity: float
    expenditure_velocity_cr: float
    planned_duration_months: int
    latitude: float = 25.6  
    longitude: float = 85.1

def get_live_weather_risk(lat: float, lon: float):
    try:
        url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=precipitation_sum&timezone=auto"
        res = requests.get(url, timeout=3).json()
        total_rain_7d = sum(res.get("daily", {}).get("precipitation_sum", [0]))
        if total_rain_7d > 100:
            return {"risk_level": "HIGH", "delay_adder_months": 1.5, "reason": "Severe rainfall/flood alert"}
        elif total_rain_7d > 40:
            return {"risk_level": "MEDIUM", "delay_adder_months": 0.5, "reason": "Moderate rainfall warning"}
        return {"risk_level": "LOW", "delay_adder_months": 0.0, "reason": "Normal weather"}
    except Exception:
        return {"risk_level": "NORMAL", "delay_adder_months": 0.0, "reason": "Weather service offline"}

@app.get("/")
def health_check():
    return {"status": "online", "system": "MoSPI Early Warning Engine"}

@app.post("/predict")
def predict_project_risk(data: ProjectPayload):
    input_dict = {
        'Ministry': data.ministry,
        'Sector': data.sector,
        'State': data.state,
        'Original_Cost_Cr': data.original_cost_cr,
        'Cumulative_Expenditure_Cr': data.cumulative_expenditure_cr,
        'Physical_Progress_Pct': data.physical_progress_pct,
        'Progress_Velocity': data.progress_velocity,
        'Expenditure_Velocity_Cr': data.expenditure_velocity_cr,
        'Planned_Duration_Months': data.planned_duration_months
    }
    
    if 'Terrain_Difficulty' in getattr(model, 'feature_names_in_', ['Terrain_Difficulty']):
        input_dict['Terrain_Difficulty'] = data.terrain_difficulty

    input_df = pd.DataFrame([input_dict])
    
    baseline_delay = float(model.predict(input_df)[0])
    weather_info = get_live_weather_risk(data.latitude, data.longitude)
    
    total_delay = baseline_delay + weather_info["delay_adder_months"]
    
    return {
        "canonical_id": data.canonical_id,
        "baseline_delay_months": round(baseline_delay, 1),
        "dynamic_adjusted_delay_months": round(total_delay, 1),
        "live_signals": {"weather": weather_info},
        "risk_badge": "HIGH RISK" if total_delay > 12 else "MODERATE RISK" if total_delay > 6 else "ON TRACK"
    }
