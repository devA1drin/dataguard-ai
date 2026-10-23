"""Train + evaluate the access-log anomaly detector (Isolation Forest).

Isolation Forest is unsupervised: it never sees the `is_anomaly` labels during
training. The synthetic labels are used only afterwards to measure how well
the unsupervised scores line up with the anomalies we injected.

Split: chronological. First 60 days = fit, last 30 days = evaluation.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.features import FEATURE_NAMES, build_features  # noqa: E402

DATA = Path(__file__).resolve().parents[2] / "data" / "generated"
MODELS = ROOT / "models"


def main() -> dict:
    logs = pd.read_csv(DATA / "access_logs.csv", parse_dates=["timestamp"])
    cutoff = logs["timestamp"].min() + pd.Timedelta(days=60)
    train, test = logs[logs.timestamp < cutoff], logs[logs.timestamp >= cutoff]
    Xtr, Xte = build_features(train), build_features(test)

    # contamination ~ expected share of suspicious events; a policy choice, tune per org.
    model = IsolationForest(n_estimators=300, contamination=0.05, random_state=42)
    model.fit(Xtr)

    raw_tr = -model.decision_function(Xtr)       # > 0  => model considers it anomalous
    scale = float(np.std(raw_tr))
    raw_te = -model.decision_function(Xte)
    risk_te = 1 / (1 + np.exp(-raw_te / scale))  # squash to 0..1; 0.5 == model boundary
    pred = (raw_te > 0).astype(int)
    y = test["is_anomaly"].values

    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    per_type = {}
    for t, g in test[test.is_anomaly == 1].groupby("anomaly_type"):
        per_type[t] = round(float(pred[np.isin(test.index, g.index)].mean()), 3)

    metrics = {
        "model": "IsolationForest(n_estimators=300, contamination=0.05)",
        "split": "chronological: first 60 days fit, last 30 days evaluated",
        "n_train": int(len(train)), "n_test": int(len(test)),
        "test_anomaly_rate": round(float(y.mean()), 4),
        "precision": round(float(precision_score(y, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y, pred, zero_division=0)), 4),
        "false_positive_rate": round(float(fp / (fp + tn)), 4),
        "roc_auc": round(float(roc_auc_score(y, raw_te)), 4),
        "average_precision": round(float(average_precision_score(y, raw_te)), 4),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "recall_by_anomaly_type": per_type,
        "risk_score_threshold": 0.5,
    }
    MODELS.mkdir(exist_ok=True)
    joblib.dump({"model": model, "scale": scale, "features": FEATURE_NAMES,
                 "background": Xtr.sample(200, random_state=0)}, MODELS / "anomaly_iforest.joblib", compress=3)
    print(json.dumps(metrics, indent=2))
    return metrics


if __name__ == "__main__":
    main()
