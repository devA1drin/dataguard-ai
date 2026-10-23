"""DataGuard AI - ML service (FastAPI).

Endpoints
  GET  /health
  POST /anomaly/score        Isolation Forest risk scores for access-log events
  POST /anomaly/explain      SHAP feature contributions per event
  POST /incidents/classify   TF-IDF + LogReg / RandomForest incident categories (both shown)
  POST /risk/forecast        trend analysis on daily counts (GET uses bundled synthetic counts)
  POST /assistant/ask        retrieval-grounded privacy assistant with citations
  GET  /metrics              evaluation results produced by training/run_all.py
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

import joblib
import numpy as np
import pandas as pd
import shap
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from .features import FEATURE_LABELS, build_features
from .forecast import forecast
from .rag import PolicyRetriever

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ml-service")
ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
DATA = Path(os.getenv("DATA_DIR", ROOT.parent / "data" / "generated"))

class State:
    anomaly: dict
    explainer: shap.TreeExplainer
    classifiers: dict
    selected: str
    retriever: PolicyRetriever
    metrics: dict


S = State()


_loaded = False


def ensure_loaded():
    """Load models once per process. Called from the ASGI lifespan (long-running server) and
    lazily from every route, so serverless runtimes that skip lifespan events still work."""
    global _loaded
    if not _loaded:
        load()
        _loaded = True


def load():
    required = ["metrics.json", "anomaly_iforest.joblib", "incident_logistic_regression.joblib", "incident_random_forest.joblib"]
    if not all((MODELS / f).exists() for f in required):
        if os.getenv("VERCEL"):
            raise RuntimeError("Trained model artifacts are missing from the deployment bundle (ml-service/models/*.joblib)")
        log.info("No trained models found - running training pipeline (synthetic data)...")
        subprocess.run([sys.executable, "-m", "training.run_all"], cwd=ROOT, check=True)
    S.anomaly = joblib.load(MODELS / "anomaly_iforest.joblib")
    S.explainer = shap.TreeExplainer(S.anomaly["model"])
    S.metrics = json.loads((MODELS / "metrics.json").read_text())
    S.classifiers = {n: joblib.load(MODELS / f"incident_{n}.joblib") for n in ("logistic_regression", "random_forest")}
    S.selected = S.metrics["incident_classification"]["selected_model"]
    S.retriever = PolicyRetriever()
    log.info("ML service ready (RAG backend: %s)", S.retriever.backend)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_loaded()
    yield


app = FastAPI(title="DataGuard AI ML Service", version="0.1.0", lifespan=lifespan,
              description="Models trained on SYNTHETIC data. Outputs are decision support, not verdicts.",
              dependencies=[Depends(ensure_loaded)])


# ---------- schemas ----------
class AccessEvent(BaseModel):
    id: Optional[str | int] = None
    hour_of_day: int = Field(ge=0, le=23)
    records_accessed: int = Field(ge=0)
    distinct_customers: int = Field(ge=0)
    export_flag: int = 0
    role: Literal["support_agent", "marketing", "analyst", "it_admin", "finance"] = "support_agent"
    off_hours: Optional[int] = None
    is_weekend: int = 0
    failed_logins: int = 0


class EventsIn(BaseModel):
    events: list[AccessEvent]
    threshold: float = 0.5


class IncidentIn(BaseModel):
    text: str = Field(min_length=5)


class SeriesIn(BaseModel):
    series: list[dict]
    horizon: int = 14


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=500)


# ---------- helpers ----------
def _score(events: list[AccessEvent]):
    X = build_features([e.model_dump() for e in events])
    raw = -S.anomaly["model"].decision_function(X)
    risk = 1 / (1 + np.exp(-raw / S.anomaly["scale"]))
    return X, raw, risk


def _explain(X: pd.DataFrame) -> list[list[dict]]:
    # SHAP values for IsolationForest explain the model's output (path length based score).
    # We flip the sign so positive contribution == pushes toward "anomalous".
    sv = -np.asarray(S.explainer.shap_values(X))
    out = []
    for i in range(len(X)):
        contrib = [{"feature": f, "label": FEATURE_LABELS.get(f, f), "value": float(X.iloc[i][f]),
                    "shap": round(float(sv[i, j]), 4)} for j, f in enumerate(X.columns)]
        out.append(sorted(contrib, key=lambda c: -abs(c["shap"])))
    return out


# ---------- routes ----------
@app.get("/health")
def health():
    return {"status": "ok", "rag_backend": S.retriever.backend, "incident_model": S.selected}


@app.post("/anomaly/score")
def anomaly_score(body: EventsIn):
    _, raw, risk = _score(body.events)
    return {"results": [{"id": e.id, "anomaly_score": round(float(r), 4), "risk_score": round(float(p), 4),
                         "flagged_for_review": bool(p >= body.threshold)}
                        for e, r, p in zip(body.events, raw, risk)],
            "threshold": body.threshold,
            "note": "Flags are for human review only and are not evidence of wrongdoing."}


@app.post("/anomaly/explain")
def anomaly_explain(body: EventsIn):
    X, raw, risk = _score(body.events)
    expl = _explain(X)
    base = float(-np.ravel(S.explainer.expected_value)[0])
    return {"results": [{"id": e.id, "risk_score": round(float(p), 4), "base_value": round(base, 4),
                         "contributions": c[:8],
                         "summary": _summarize(c)} for e, p, c in zip(body.events, risk, expl)]}


def _summarize(contrib: list[dict]) -> str:
    top = [c for c in contrib if c["shap"] > 0][:3]
    if not top:
        return "No feature strongly pushed this event toward anomalous."
    return "Main factors raising the score: " + ", ".join(f"{c['label']} ({c['value']:g})" for c in top) + "."


@app.post("/incidents/classify")
def classify(body: IncidentIn):
    out = {}
    for name, pipe in S.classifiers.items():
        proba = pipe.predict_proba([body.text])[0]
        order = np.argsort(-proba)
        out[name] = {"category": str(pipe.classes_[order[0]]), "confidence": round(float(proba[order[0]]), 4),
                     "top3": [{"category": str(pipe.classes_[i]), "p": round(float(proba[i]), 4)} for i in order[:3]]}
    sel = out[S.selected]
    return {"category": sel["category"], "confidence": sel["confidence"], "selected_model": S.selected,
            "models": out, "agree": len({v["category"] for v in out.values()}) == 1}


def _default_series(column: str):
    df = pd.read_csv(DATA / "daily_counts.csv")
    return [{"date": d, "count": int(c)} for d, c in zip(df.date, df[column])]


@app.get("/risk/forecast")
def risk_forecast_default(metric: Literal["anomalies", "incidents"] = "anomalies", horizon: int = 14):
    return {"metric": metric, "source": "bundled synthetic daily counts", **forecast(_default_series(metric), horizon)}


@app.post("/risk/forecast")
def risk_forecast(body: SeriesIn):
    try:
        return {"source": "provided series", **forecast(body.series, body.horizon)}
    except (ValueError, KeyError) as e:
        raise HTTPException(422, str(e))


@app.post("/assistant/ask")
def ask(body: AskIn):
    return S.retriever.ask(body.question)


@app.get("/metrics")
def metrics():
    return S.metrics
