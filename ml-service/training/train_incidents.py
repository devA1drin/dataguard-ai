"""Train + compare two incident-report text classifiers:
  A) TF-IDF + Logistic Regression
  B) TF-IDF + Random Forest
Stratified 80/20 split, plus 5-fold CV macro-F1 on the training portion.
The better model by test macro-F1 is saved as the serving model (both are saved).
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.pipeline import Pipeline

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(__file__).resolve().parents[2] / "data" / "generated"
MODELS = ROOT / "models"


def make_pipelines():
    tfidf = dict(ngram_range=(1, 2), min_df=2, sublinear_tf=True, stop_words="english")
    return {
        "logistic_regression": Pipeline([("tfidf", TfidfVectorizer(**tfidf)),
                                         ("clf", LogisticRegression(max_iter=2000, C=5.0))]),
        "random_forest": Pipeline([("tfidf", TfidfVectorizer(**tfidf)),
                                   ("clf", RandomForestClassifier(n_estimators=300, random_state=42, n_jobs=-1))]),
    }


def main() -> dict:
    df = pd.read_csv(DATA / "incidents.csv")
    Xtr, Xte, ytr, yte = train_test_split(df.description, df.category, test_size=0.2,
                                          stratify=df.category, random_state=42)
    results = {}
    MODELS.mkdir(exist_ok=True)
    for name, pipe in make_pipelines().items():
        cv = cross_val_score(pipe, Xtr, ytr, cv=5, scoring="f1_macro")
        pipe.fit(Xtr, ytr)
        pred = pipe.predict(Xte)
        labels = sorted(df.category.unique())
        rep = classification_report(yte, pred, output_dict=True, zero_division=0)
        results[name] = {
            "accuracy": round(accuracy_score(yte, pred), 4),
            "macro_precision": round(rep["macro avg"]["precision"], 4),
            "macro_recall": round(rep["macro avg"]["recall"], 4),
            "macro_f1": round(f1_score(yte, pred, average="macro"), 4),
            "cv5_macro_f1_mean": round(float(cv.mean()), 4), "cv5_macro_f1_std": round(float(cv.std()), 4),
            "per_class": {k: {m: round(v[m], 3) for m in ("precision", "recall", "f1-score")}
                          for k, v in rep.items() if k in labels},
            "labels": labels,
            "confusion_matrix": confusion_matrix(yte, pred, labels=labels).tolist(),
        }
        joblib.dump(pipe, MODELS / f"incident_{name}.joblib", compress=3)  # small enough to commit
    best = max(results, key=lambda k: results[k]["macro_f1"])
    out = {"n_train": int(len(Xtr)), "n_test": int(len(Xte)), "label_noise_injected": 0.04,
           "models": results, "selected_model": best}
    print(json.dumps({k: {m: v[m] for m in ("accuracy", "macro_f1", "cv5_macro_f1_mean")}
                      for k, v in results.items()}, indent=2), "selected:", best)
    return out


if __name__ == "__main__":
    main()
