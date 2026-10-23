"""Simple, explainable risk trend analysis on daily counts.

Method: 7-day rolling mean for smoothing + ordinary least squares linear regression on
the last `window` days, projected `horizon` days ahead with a +/- 1.96*residual-std band.
This is deliberately simple trend analysis, not a sophisticated forecasting model.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np


def forecast(series: list[dict], horizon: int = 14, window: int = 30) -> dict:
    """series: [{"date": "YYYY-MM-DD", "count": int}, ...] sorted or unsorted."""
    series = sorted(series, key=lambda r: r["date"])
    if len(series) < 7:
        raise ValueError("need at least 7 days of data")
    counts = np.array([float(r["count"]) for r in series])
    rolling = np.convolve(counts, np.ones(7) / 7, mode="full")[: len(counts)]
    rolling[:6] = [counts[: i + 1].mean() for i in range(6)]
    recent = counts[-window:]
    x = np.arange(len(recent))
    slope, intercept = np.polyfit(x, recent, 1)
    resid_std = float(np.std(recent - (slope * x + intercept)))
    last = date.fromisoformat(series[-1]["date"])
    proj = []
    for h in range(1, horizon + 1):
        yhat = max(0.0, slope * (len(recent) - 1 + h) + intercept)
        proj.append({"date": (last + timedelta(days=h)).isoformat(), "predicted": round(yhat, 2),
                     "lower": round(max(0.0, yhat - 1.96 * resid_std), 2), "upper": round(yhat + 1.96 * resid_std, 2)})
    baseline = float(counts[:-window].mean()) if len(counts) > window else float(counts.mean())
    recent_mean = float(recent[-7:].mean())
    change = (recent_mean - baseline) / baseline if baseline > 0 else 0.0
    level = "high" if slope > 0.05 and change > 0.25 else "elevated" if slope > 0 or change > 0.1 else "stable"
    return {
        "history": [{"date": r["date"], "count": int(c), "rolling_7d": round(float(m), 2)}
                    for r, c, m in zip(series, counts, rolling)],
        "forecast": proj,
        "trend": {"slope_per_day": round(float(slope), 4), "recent_7d_mean": round(recent_mean, 2),
                  "baseline_mean": round(baseline, 2), "pct_change_vs_baseline": round(change * 100, 1),
                  "risk_level": level},
        "method": f"7-day rolling mean + OLS linear trend on last {min(window, len(counts))} days",
    }
