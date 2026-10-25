"""Hand-crafted, human-readable features for the phishing detector (shared by training and serving)."""
from __future__ import annotations

import re
from urllib.parse import urlparse

SUSPICIOUS_TLDS = {"xyz", "top", "click", "info", "online", "site", "live", "shop", "icu", "buzz", "zip", "mov"}
SHORTENERS = {"bit.ly", "tinyurl.com", "rb.gy", "cutt.ly", "is.gd", "t.co", "goo.gl"}
BAIT = ["login", "verify", "secure", "update", "account", "confirm", "wallet", "unlock", "billing", "support", "reward", "claim", "signin", "password"]
BRANDS = ["bdo", "bpi", "gcash", "maya", "lazada", "shopee", "paypal", "netflix", "microsoft", "office365", "apple", "sss", "philhealth", "metrobank"]

URL_FEATURES = ["URL length", "Uses plain HTTP (no TLS)", "Host is an IP address", "Number of dots in host", "Hyphens in host",
                "Contains '@'", "Suspicious top-level domain", "URL shortener", "Punycode (xn--) host", "Bait words (login/verify/...)",
                "Brand name outside the real domain", "Digits in host", "Path depth", "Has query string"]


def _host(url: str) -> str:
    u = url if "://" in url else "http://" + url
    try:
        return (urlparse(u).hostname or "").lower()
    except ValueError:
        return ""


def url_features(url: str) -> list[float]:
    u = url.strip()
    low = u.lower()
    host = _host(u)
    parts = host.split(".")
    tld = parts[-1] if parts else ""
    registered = ".".join(parts[-3:]) if len(parts) >= 3 and parts[-2] in {"com", "gov", "edu", "org", "net"} else ".".join(parts[-2:])
    brand_elsewhere = any(b in low and not registered.startswith(b + ".") for b in BRANDS)
    path = low.split(host, 1)[-1] if host else low
    return [len(u), float(low.startswith("http://")), float(bool(re.fullmatch(r"\d+\.\d+\.\d+\.\d+", host))), host.count("."),
            host.count("-"), float("@" in u), float(tld in SUSPICIOUS_TLDS), float(host in SHORTENERS), float("xn--" in host),
            sum(w in low for w in BAIT), float(brand_elsewhere), sum(c.isdigit() for c in host), path.count("/"), float("?" in u)]


EMAIL_FEATURES = ["Number of links", "Link to an IP address", "Urgency words", "Asks for password/card/OTP", "Money or prize mentioned",
                  "Suspicious link inside"]
URGENT = ["urgent", "immediately", "within 24 hours", "final notice", "suspended", "action required", "today", "ngayon", "permanently"]
ASKS = ["password", "card details", "username", "pin", "re-validate", "verify your identity", "confirm your password", "enable macros", "i-verify"]
MONEY = ["p50,000", "won", "prize", "reward", "raffle", "fee", "wire transfer", "refund", "claim"]
URL_RE = re.compile(r"(https?://[^\s)>\"']+)", re.I)


def email_features(text: str) -> list[float]:
    low = text.lower()
    links = URL_RE.findall(text)
    sus = 0.0
    for ln in links:
        f = url_features(ln)
        if f[2] or f[6] or f[7] or f[8] or f[10]:
            sus = 1.0
    return [len(links), float(any(re.match(r"https?://\d+\.\d+\.\d+\.\d+", ln) for ln in links)), sum(w in low for w in URGENT),
            sum(w in low for w in ASKS), sum(w in low for w in MONEY), sus]
