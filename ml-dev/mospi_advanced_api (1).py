from fastapi import FastAPI
from pydantic import BaseModel
import joblib
import pandas as pd
import requests
import random

app = FastAPI(title="MoSPI Advanced Risk Engine")

# 1. Load the frozen XGBoost Model
MODEL_PATH = "/content/drive/MyDrive/xgboost_delay_model_enhanced.pkl"
model = joblib.load(MODEL_PATH)

# 2. Define the React Frontend Payload
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

# 3. Live Weather API (Real Open-Meteo Data)
def get_live_weather_risk(lat: float, lon: float):
    try:
        url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&daily=precipitation_sum&timezone=auto"
        res = requests.get(url, timeout=3).json()
        total_rain_7d = sum(res.get("daily", {}).get("precipitation_sum", [0]))
        if total_rain_7d > 100:
            return {"risk_level": "HIGH", "delay_adder": 1.5, "reason": "Severe rainfall/flood alert"}
        elif total_rain_7d > 40:
            return {"risk_level": "MEDIUM", "delay_adder": 0.5, "reason": "Moderate rainfall warning"}
        return {"risk_level": "LOW", "delay_adder": 0.0, "reason": "Normal weather"}
    except Exception:
        return {"risk_level": "NORMAL", "delay_adder": 0.0, "reason": "Weather service offline"}

# 4. Material Weighting Matrix (Enterprise Commodity Logic)
MATERIAL_MATRIX = {
    "Roads": {"steel": 0.15, "cement": 0.40, "bitumen": 0.45},
    "Railways": {"steel": 0.60, "cement": 0.20, "copper": 0.20},
    "Power": {"steel": 0.40, "cement": 0.30, "copper": 0.30}
}

def get_commodity_risk(sector: str):
    # Simulating a live pull from data.gov.in WPI indices
    live_market_inflation = {"steel": 12.5, "cement": 3.0, "bitumen": 8.0, "copper": 15.0} # Mock live data
    
    weights = MATERIAL_MATRIX.get(sector, {"steel": 0.33, "cement": 0.33, "bitumen": 0.34})
    total_cost_shock_pct = sum((weights.get(mat, 0) * live_market_inflation.get(mat, 0)) for mat in weights)
    
    if total_cost_shock_pct > 8.0:
        return {"risk_level": "HIGH", "delay_adder": 2.0, "reason": f"{sector} materials inflated by {total_cost_shock_pct:.1f}%"}
    return {"risk_level": "LOW", "delay_adder": 0.0, "reason": "Commodity prices stable"}

# 5. Local Disruption / News API (Entity Resolution Logic)
def get_local_disruption_risk(state: str, sector: str):
    # Here is where you construct the hyper-specific query for NewsAPI/GDELT
    simulated_search_query = f'("{sector}") AND "{state}" AND ("protest" OR "land acquisition")'
    
    # For the hackathon prototype, we trigger a "hit" randomly to simulate finding an article
    if random.random() > 0.8: 
        return {"risk_level": "CRITICAL", "delay_adder": 3.0, "reason": f"News Alert: Land dispute detected for {sector} in {state}"}
    return {"risk_level": "LOW", "delay_adder": 0.0, "reason": "No local disruptions in news"}

# 6. The Master Prediction Endpoint
@app.post("/predict")
def predict_project_risk(data: ProjectPayload):
    # A. Run XGBoost Baseline
    input_dict = {
        'Ministry': data.ministry, 'Sector': data.sector, 'State': data.state,
        'Original_Cost_Cr': data.original_cost_cr, 'Cumulative_Expenditure_Cr': data.cumulative_expenditure_cr,
        'Physical_Progress_Pct': data.physical_progress_pct, 'Progress_Velocity': data.progress_velocity,
        'Expenditure_Velocity_Cr': data.expenditure_velocity_cr, 'Planned_Duration_Months': data.planned_duration_months
    }
    if 'Terrain_Difficulty' in getattr(model, 'feature_names_in_', []):
        input_dict['Terrain_Difficulty'] = data.terrain_difficulty

    baseline_delay = float(model.predict(pd.DataFrame([input_dict]))[0])
    
    # B. Fetch Live Hindrances
    weather = get_live_weather_risk(data.latitude, data.longitude)
    commodity = get_commodity_risk(data.sector)
    news = get_local_disruption_risk(data.state, data.sector)
    
    # C. Calculate Final Adjusted Delay
    total_delay = baseline_delay + weather["delay_adder"] + commodity["delay_adder"] + news["delay_adder"]
    
    return {
        "canonical_id": data.canonical_id,
        "baseline_delay_months": round(baseline_delay, 1),
        "dynamic_adjusted_delay_months": round(total_delay, 1),
        "live_signals": {
            "weather": weather,
            "commodities": commodity,
            "news_disruptions": news
        },
        "risk_badge": "CRITICAL RISK" if total_delay > 24 else "HIGH RISK" if total_delay > 12 else "ON TRACK"
    }
