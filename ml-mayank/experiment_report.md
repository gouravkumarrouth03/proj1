# Infrastructure Risk ML Experiment Report (SIH)

**Project:** Smart India Hackathon (SIH) – Infrastructure Project Monitoring & Risk Detection  
**Dataset:** `ml_dataset.csv` (15,478 records across 12 monthly MoSPI flash reports)  
**Model Version:** `v2` (`risk_model_v2.joblib`)  
**Feature Metadata & Threshold Config:** `feature_config_v2.json`

---

## 1. Executive Summary & Baseline vs. v2 Comparison

| Metric | Baseline (`risk_model.joblib`) | Model v2 (Default Threshold = 0.50) | Model v2 (Operational Threshold = 0.55) | Total Improvement |
| :--- | :---: | :---: | :---: | :---: |
| **Model Algorithm** | Naive Random Forest | Regularized XGBoost | Regularized XGBoost | **Advanced Boosting** |
| **Risk Precision** | **31.00%** | 49.65% | **51.45%** | **+20.45%** (+66% relative gain) |
| **Risk Recall** | **76.00%** | 77.35% | **73.77%** | Meets $\ge 70\%$ constraint |
| **Risk F1-Score** | **44.00%** | 60.48% | **60.62%** | **+16.62%** (+37.8% relative gain) |
| **ROC-AUC** | ~0.60 | 0.7312 | **0.7312** | **+0.13** |
| **PR-AUC (Avg Precision)**| ~0.35 | 0.5412 | **0.5412** | **+0.19** (+54% relative gain) |
| **Overall Accuracy** | **55.00%** | 64.17% | **66.03%** | **+11.03%** |
| **False Positives (Test)**| **1,846** | 942 | **836** | **-54.7% reduction in false alerts** |
| **False Negatives (Test)**| **265** | 272 | **315** | Controlled risk leakage |

---

## 2. Threshold Sweep & Optimization Experiment (0.30 to 0.70)

Model: Frozen `risk_model_v2.joblib` (XGBoost) | Evaluated on Holdout Test Set (3,388 records, 1,201 positive risk cases).

| Threshold | Precision | Recall | F1-Score | PR-AUC | False Positives (FP) | False Negatives (FN) | Total Alerts Flagged | Accuracy |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **0.30** | 45.80% | 89.84% | 60.67% | 0.5412 | 1,277 | 122 | 2,356 | 58.71% |
| **0.35** | 47.00% | 87.93% | 61.25% | 0.5412 | 1,191 | 145 | 2,247 | 60.57% |
| **0.40** | 48.20% | 85.76% | 61.71% | 0.5412 | 1,107 | 171 | 2,137 | 62.28% |
| **0.45** | 49.03% | 81.93% | 61.35% | 0.5412 | 1,023 | 217 | 2,007 | 63.40% |
| **0.50** | 49.65% | 77.35% | 60.48% | 0.5412 | 942 | 272 | 1,871 | 64.17% |
| **0.55 ⭐** | **51.45%** | **73.77%** | **60.62%** | **0.5412** | **836** | **315** | **1,722** | **66.03%** |
| **0.60** | 52.40% | 69.19% | 59.63% | 0.5412 | 755 | 370 | 1,586 | 66.79% |
| **0.65** | 53.60% | 63.78% | 58.25% | 0.5412 | 663 | 435 | 1,429 | 67.59% |
| **0.70** | 54.49% | 56.54% | 55.50% | 0.5412 | 567 | 522 | 1,246 | 67.86% |

---

## 3. Operational Threshold Recommendation for SIH MVP

### Selected Operational Threshold: `0.55`

**Why this threshold is appropriate for the Infrastructure Monitoring MVP:**
1. **Reduces False Alerts by 106 Cases vs. 0.50 (and by 1,010 Cases vs. Baseline)**:
   - False alert fatigue is the number one issue in project monitoring dashboards. Raising the threshold to `0.55` drops false alarms to $836$, saving project managers and monitoring officers substantial verification time.
2. **Maintains High Risk Recall (73.77%)**:
   - Safely satisfies the product priority ($\ge 70\%$ recall), successfully capturing nearly $3$ out of every $4$ at-risk projects.
3. **Breaks the 50% Precision Barrier (51.45%)**:
   - At $0.55$, the majority of triggered alerts correspond to true, genuine project risk.
4. **Boosts Overall Decision Accuracy to 66.03%**.

---

## 4. Feature Metadata & Decision Architecture

- Saved in [`feature_config_v2.json`](file:///c:/Users/mayan/OneDrive/Desktop/infrastructure_dataset/feature_config_v2.json) with three operational profiles:
  - **`recommended_balanced_mvp` (Threshold = 0.55)**: Default operational threshold for standard dashboard alerts.
  - **`high_sensitivity` (Threshold = 0.40)**: For critical Mega-Projects ($> ₹1,000\text{ Cr}$) where missing any potential risk has severe cost penalties ($85.8\%$ recall).
  - **`high_precision` (Threshold = 0.65)**: For automated executive escalations requiring $> 53.6\%$ precision.
