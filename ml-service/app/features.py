"""Feature engineering shared by training and serving (single source of truth,
so the API computes features exactly the way the model was trained)."""
from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd

EMP_ROLES = ["support_agent", "marketing", "analyst", "it_admin", "finance"]

NUMERIC_FEATURES = ["hour_of_day", "records_accessed", "distinct_customers", "off_hours",
                    "is_weekend", "export_flag", "failed_logins"]
ROLE_FEATURES = [f"role_{r}" for r in EMP_ROLES]
FEATURE_NAMES = NUMERIC_FEATURES + ["log_records", "distinct_ratio"] + ROLE_FEATURES

# Human-readable labels used in SHAP explanations
FEATURE_LABELS = {
    "hour_of_day": "Hour of day", "records_accessed": "Records accessed",
    "distinct_customers": "Distinct customers", "off_hours": "Off-hours access",
    "is_weekend": "Weekend access", "export_flag": "Data export", "failed_logins": "Failed logins",
    "log_records": "Volume (log scale)", "distinct_ratio": "Distinct/records ratio",
    **{f"role_{r}": f"Role = {r}" for r in EMP_ROLES},
}


def build_features(rows: Iterable[dict] | pd.DataFrame) -> pd.DataFrame:
    """Turn raw access-log rows into the model feature matrix.

    Accepts dicts with keys: hour_of_day, records_accessed, distinct_customers,
    export_flag, role, and optionally off_hours, is_weekend, failed_logins.
    """
    df = pd.DataFrame(rows).copy()
    for col, default in [("off_hours", None), ("is_weekend", 0), ("failed_logins", 0), ("export_flag", 0)]:
        if col not in df.columns:
            df[col] = default
    if df["off_hours"].isna().any():
        derived = ((df["hour_of_day"] < 7) | (df["hour_of_day"] >= 20) | (df["is_weekend"] == 1)).astype(int)
        df["off_hours"] = df["off_hours"].fillna(derived)
    for c in NUMERIC_FEATURES:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).astype(float)
    df["log_records"] = np.log1p(df["records_accessed"])
    df["distinct_ratio"] = df["distinct_customers"] / df["records_accessed"].clip(lower=1)
    role = df.get("role", pd.Series(["support_agent"] * len(df))).fillna("support_agent")
    for r in EMP_ROLES:
        df[f"role_{r}"] = (role == r).astype(float)
    return df[FEATURE_NAMES]
