"""Phishing detector - URL model and e-mail model, trained on SYNTHETIC data only.

Data source (honest disclosure): every URL and e-mail below is produced by the template
generator in this file (seeded, deterministic). No real phishing corpus is used, so there is
no licensing question - but it also means the scores describe how well the models separate
*these synthetic patterns*. Real-world accuracy would be lower. Label noise (3%) and
deliberately ambiguous "hard" examples are injected so the task is not trivially separable.

Models (scikit-learn, explainable on purpose):
  URL:    character 3-5-gram TF-IDF + 14 hand-crafted URL features -> Logistic Regression
  E-mail: word 1-2-gram TF-IDF + 6 hand-crafted features          -> Logistic Regression
Explanations = coefficient x feature value (exact for a linear model).

Run (from ml-service/):  python -m training.train_phishing   (also called by run_all)
"""
from __future__ import annotations

import json
import random
import re
import sys
from pathlib import Path

import joblib
import numpy as np
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.phishing_features import EMAIL_FEATURES, URL_FEATURES, email_features, url_features  # noqa: E402

SEED = 7
NOISE = 0.03

LEGIT_DOMAINS = ["bdo.com.ph", "bpi.com.ph", "gcash.com", "maya.ph", "lazada.com.ph", "shopee.ph", "gov.ph", "sss.gov.ph",
                 "philhealth.gov.ph", "pldthome.com", "globe.com.ph", "smart.com.ph", "google.com", "microsoft.com",
                 "github.com", "wikipedia.org", "up.edu.ph", "dlsu.edu.ph", "rappler.com", "inquirer.net", "dataguard.example"]
BRANDS = ["bdo", "bpi", "gcash", "maya", "lazada", "shopee", "paypal", "netflix", "microsoft", "office365", "apple", "sss", "philhealth", "metrobank"]
BAD_TLDS = ["xyz", "top", "click", "info", "online", "site", "live", "shop", "icu", "buzz"]
OK_TLDS = ["com", "ph", "com.ph", "net", "org"]
BAIT = ["login", "verify", "secure", "update", "account", "confirm", "wallet", "unlock", "billing", "support", "reward", "claim"]
PATHS_OK = ["", "/", "/about", "/help", "/products", "/news/2026/10/update", "/careers", "/account/settings", "/login", "/docs/getting-started",
            "/search?q=privacy", "/promo/11-11", "/faq", "/contact-us"]
SHORT = ["bit.ly", "tinyurl.com", "rb.gy", "cutt.ly", "is.gd"]


def gen_urls(rng: random.Random, n: int) -> list[tuple[str, int]]:
    out = []
    for _ in range(n // 2):  # legitimate
        d = rng.choice(LEGIT_DOMAINS)
        sub = rng.choice(["", "www.", "www.", "m.", "help.", "accounts."])
        path = rng.choice(PATHS_OK)
        scheme = "https://" if rng.random() > 0.05 else "http://"
        u = f"{scheme}{sub}{d}{path}"
        if rng.random() < 0.08:  # hard legit: long tracking links, shorteners
            u = rng.choice([f"https://{rng.choice(SHORT)}/{rng.randrange(10**5, 10**7):x}",
                            f"https://{d}/track?utm_source=email&utm_campaign=promo&id={rng.randrange(10**8)}"])
        out.append((u, 0))
    for _ in range(n - n // 2):  # phishing
        b, bait = rng.choice(BRANDS), rng.choice(BAIT)
        style = rng.random()
        if style < 0.25:
            host = f"{b}-{bait}.{rng.choice(BAD_TLDS)}"
        elif style < 0.4:
            host = f"{rng.randrange(11, 223)}.{rng.randrange(256)}.{rng.randrange(256)}.{rng.randrange(1, 255)}"
        elif style < 0.55:
            host = f"{b}.com.{bait}-{rng.randrange(100, 999)}.{rng.choice(BAD_TLDS + OK_TLDS)}"
        elif style < 0.65:
            host = b.replace("o", "0").replace("a", "4").replace("l", "1") + "." + rng.choice(OK_TLDS)
        elif style < 0.72:
            host = f"xn--{b}-{rng.randrange(10, 99)}a.{rng.choice(OK_TLDS)}"
        elif style < 0.8:
            host = rng.choice(SHORT)
        elif style < 0.9:
            host = f"secure.{rng.choice(['mail', 'docs', 'drive', 'pay'])}-{bait}{rng.randrange(10)}.{rng.choice(BAD_TLDS)}"
        else:  # hard phish: clean-looking host on a common TLD
            host = f"{rng.choice(['my', 'get', 'e'])}{b}{rng.choice(['', 'ph', 'online'])}.{rng.choice(OK_TLDS)}"
        path = rng.choice([f"/{bait}", f"/{bait}/{b}", f"/{b}/{bait}.php", f"/wp-content/{bait}/index.html", f"/{bait}?id={rng.randrange(10**6)}",
                           f"/{bait}@{b}.com", "/", f"/s/{rng.randrange(10**5):x}"])
        scheme = "https://" if rng.random() < 0.55 else "http://"
        out.append((f"{scheme}{host}{path}", 1))
    return out


GREET = ["Hi", "Hello", "Dear customer", "Good day", "Magandang araw", "Dear valued user", "Hi team"]
PHISH_BODY = [
    "Your {b} account has been suspended due to unusual activity. Verify your identity within 24 hours or it will be permanently closed: {link}",
    "We detected a login from a new device. If this wasn't you, confirm your password immediately at {link}",
    "Congratulations! You won a P50,000 {b} raffle. Claim your reward now by entering your card details: {link}",
    "Your package could not be delivered. Pay the P85 redelivery fee here: {link}",
    "Invoice #{n} is overdue. Download the attached invoice and enable macros to view it.",
    "URGENT: Payroll update required. Send your username and password to HR before 5PM today.",
    "I-verify ang iyong {b} account ngayon upang hindi ma-block. I-click ang link: {link}",
    "Your mailbox is full. Re-validate your Office365 account to keep receiving e-mails: {link}",
    "Final notice: your SSS benefits will be cancelled. Update your details here: {link}",
    "Please process this wire transfer today, I'm in a meeting and can't talk. Reply with confirmation. - CEO",
]
LEGIT_BODY = [
    "Thanks for your order #{n}. Your items will arrive on Friday. You can track the delivery in the app.",
    "Reminder: the team meeting is moved to 3PM in Conference Room B. Agenda attached.",
    "Your monthly statement for October is now available. Log in to the {b} app to view it.",
    "Here are the minutes from yesterday's privacy committee meeting. Please review section 3.",
    "Your one-time PIN is {n}. Never share this code with anyone, including {b} staff.",
    "We received your data access request. We will reply within 15 working days.",
    "Hi! Attached is the draft capstone report. Can you check the methodology chapter before Monday?",
    "You requested a password reset. If this was you, use the link in the app; otherwise ignore this e-mail.",
    "Our office will be closed on November 1 for All Saints' Day. Regular hours resume November 4.",
    "Salamat sa iyong pagbili! Ang iyong resibo ay naka-attach.",
]
SIGN = ["", "\n\nThank you,\nCustomer Care", "\n\nRegards,\nIT Security", "\n\n- Sent from my phone", "\n\nSalamat po."]


def gen_emails(rng: random.Random, n: int, urls: list[tuple[str, int]]) -> list[tuple[str, int]]:
    bad = [u for u, y in urls if y == 1]
    good = [u for u, y in urls if y == 0]
    out = []
    for i in range(n):
        y = i % 2
        tpl = rng.choice(PHISH_BODY if y else LEGIT_BODY)
        link = rng.choice(bad if y else good)
        body = tpl.format(b=rng.choice(BRANDS).upper(), link=link, n=rng.randrange(100000, 999999))
        if not y and rng.random() < 0.25:
            body += f" More info: {link}"
        if y and rng.random() < 0.15:  # hard phish: calm tone
            body = f"Please review the shared document: {link}"
        if not y and rng.random() < 0.05:  # hard legit: urgent but genuine
            body = "URGENT: the server room will lose power at 6PM. Save your work and log out before then."
        subj = ("Action required" if y and rng.random() < 0.5 else rng.choice(["Update", "Notice", "Re: follow-up", "Your account", "Hello"]))
        out.append((f"Subject: {subj}\n\n{rng.choice(GREET)},\n\n{body}{rng.choice(SIGN)}", y))
    return out


def noisy(rows, rng):
    return [(x, 1 - y if rng.random() < NOISE else y) for x, y in rows]


def evaluate(y, p):
    pred = (p >= 0.5).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred).ravel()
    return {"precision": round(float(precision_score(y, pred)), 4), "recall": round(float(recall_score(y, pred)), 4),
            "f1": round(float(f1_score(y, pred)), 4), "roc_auc": round(float(roc_auc_score(y, p)), 4),
            "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}, "n_test": int(len(y))}


def fit(texts, y, vec, feats_fn, names, rng_seed):
    Xtr_t, Xte_t, ytr, yte = train_test_split(texts, y, test_size=0.25, random_state=rng_seed, stratify=y)
    scaler = StandardScaler()
    Htr = scaler.fit_transform(np.array([feats_fn(t) for t in Xtr_t]))
    Hte = scaler.transform(np.array([feats_fn(t) for t in Xte_t]))
    Xtr = hstack([vec.fit_transform(Xtr_t), csr_matrix(Htr)]).tocsr()
    Xte = hstack([vec.transform(Xte_t), csr_matrix(Hte)]).tocsr()
    model = LogisticRegression(C=0.5, max_iter=3000)
    model.fit(Xtr, ytr)
    m = evaluate(np.array(yte), model.predict_proba(Xte)[:, 1])
    m["n_train"] = int(len(ytr))
    return {"vectorizer": vec, "scaler": scaler, "model": model, "hand_features": names}, m


def main() -> dict:
    rng = random.Random(SEED)
    urls = gen_urls(rng, 4000)
    emails = gen_emails(rng, 3000, urls)
    urls, emails = noisy(urls, rng), noisy(emails, rng)
    u_art, u_m = fit([u for u, _ in urls], [y for _, y in urls],
                     TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), max_features=4000, sublinear_tf=True),
                     url_features, URL_FEATURES, SEED)
    e_art, e_m = fit([e for e, _ in emails], [y for _, y in emails],
                     TfidfVectorizer(ngram_range=(1, 2), max_features=5000, min_df=2, sublinear_tf=True, token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z0-9']+\b"),
                     email_features, EMAIL_FEATURES, SEED)
    joblib.dump(u_art, ROOT / "models" / "phishing_url.joblib", compress=3)
    joblib.dump(e_art, ROOT / "models" / "phishing_email.joblib", compress=3)
    out = {
        "data_source": "SYNTHETIC - generated by ml-service/training/train_phishing.py (seed 7, 3% label noise, injected hard cases). The same templates appear in the train and test splits, so these scores measure recognition of the synthetic patterns, not generalisation to new phishing campaigns. "
                       "No real phishing corpus is used. Real-world accuracy will be lower.",
        "threshold": 0.5,
        "url_model": {"algorithm": "char 3-5-gram TF-IDF + 14 URL features -> Logistic Regression", **u_m},
        "email_model": {"algorithm": "word 1-2-gram TF-IDF + 6 text features -> Logistic Regression", **e_m},
        "attack_technique": "T1566",
    }
    print(json.dumps(out, indent=2))
    return out


if __name__ == "__main__":
    res = main()
    mpath = ROOT / "models" / "metrics.json"
    metrics = json.loads(mpath.read_text())
    metrics["phishing_detection"] = res
    mpath.write_text(json.dumps(metrics, indent=2))
    print("Updated", mpath)
