"""Build db/migrations/003_security_seed.sql - SYNTHETIC sign-in attempts, a SAMPLE
threat-intel list and the security alerts those attempts would trigger.

Everything here is made up:
* IP addresses come only from the documentation ranges in RFC 5737
  (198.51.100.0/24 and 203.0.113.0/24 = "normal" users, 192.0.2.0/24 = "attackers").
* E-mail addresses use the reserved .example / example.ph domains and are NOT login accounts.
* Locations are synthetic (city centre coordinates), no geolocation service is used.

Timestamps are relative to the moment the SQL is loaded, so the SOC dashboard always
shows the last 14 days. The file is idempotent: it inserts nothing if synthetic rows
already exist. Standard library only.  Run:  python db/build_security_seed.py
"""
from __future__ import annotations

import csv
import hashlib
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "data" / "generated"
OUT = ROOT / "db" / "migrations" / "003_security_seed.sql"
DAYS = 14
rng = random.Random(20261025)

PH = {"Manila": (14.5995, 120.9842), "Quezon City": (14.6760, 121.0437), "Makati": (14.5547, 121.0244),
      "Pasig": (14.5764, 121.0851), "Taguig": (14.5176, 121.0509), "Cebu City": (10.3157, 123.8854),
      "Davao City": (7.1907, 125.4553), "Iloilo City": (10.7202, 122.5621), "Baguio": (16.4023, 120.5960)}
ABROAD = {"Frankfurt": ("DE", 50.1109, 8.6821), "Sao Paulo": ("BR", -23.5505, -46.6333),
          "Toronto": ("CA", 43.6532, -79.3832), "Amsterdam": ("NL", 52.3676, 4.9041)}
UAS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
       "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
       "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
       "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
       "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"]
ATTACK_UAS = ["python-requests/2.32.3", "Mozilla/5.0 (compatible; Hydra)", "curl/8.9.1", "Go-http-client/1.1"]

THREATS = [("192.0.2.13", "brute_force", 90, "Repeated password guessing against many portals (sample)"),
           ("192.0.2.27", "credential_stuffing", 85, "Replays leaked username/password pairs (sample)"),
           ("192.0.2.66", "credential_stuffing", 80, "Password-spraying source (sample)"),
           ("192.0.2.77", "tor_exit", 60, "Anonymising relay exit node (sample)"),
           ("192.0.2.101", "botnet", 75, "Known botnet node (sample)"),
           ("192.0.2.150", "scanner", 50, "Mass internet scanner (sample)"),
           ("192.0.2.192/27", "scanner", 40, "Scanner hosting range (sample)")]


def q(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def dev(ua: str) -> str:
    return hashlib.sha256(ua.encode()).hexdigest()[:16]


def main() -> None:
    with open(GEN / "customers.csv", encoding="utf-8") as f:
        customers = list(csv.DictReader(f))[:30]
    with open(GEN / "employees.csv", encoding="utf-8") as f:
        employees = list(csv.DictReader(f))[:12]
    accounts = [c["email"] for c in customers] + \
               [e["name"].lower().replace(" ", ".") + "@staff.dataguard.example" for e in employees]
    profile = {}
    for i, a in enumerate(accounts):
        city = rng.choice(list(PH))
        net = "198.51.100" if i % 2 else "203.0.113"
        profile[a] = {"city": city, "ip": f"{net}.{10 + i}", "uas": rng.sample(UAS, 2)}

    rows = []      # (minutes_ago, email, ip, ua, success, reason, country, city, lat, lon, threat)
    alerts = []    # (minutes_ago, rule, technique, severity, title, desc, email, ip, details)

    def add(m, email, ip, ua, ok, reason, country, city, lat, lon, threat=None):
        rows.append((m, email, ip, ua, ok, reason, country, city, lat, lon, threat))

    # 1) normal traffic: a few sign-ins per account per day, with the odd typo
    for d in range(DAYS):
        for a in accounts:
            p = profile[a]
            for _ in range(rng.choice([0, 0, 1, 1, 1, 2])):
                hour = rng.choice([7, 8, 9, 10, 11, 13, 14, 15, 16, 19, 20, 21])
                m = d * 1440 + (24 - hour) * 60 + rng.randint(0, 59)
                ua = p["uas"][0] if rng.random() < 0.8 else p["uas"][1]
                lat, lon = PH[p["city"]]
                if rng.random() < 0.07:
                    add(m + 1, a, p["ip"], ua, False, "bad_password", "PH", p["city"], lat, lon)
                add(m, a, p["ip"], ua, True, "ok", "PH", p["city"], lat, lon)
    # background noise from scanners against non-existent accounts
    for d in range(DAYS):
        for _ in range(rng.randint(2, 6)):
            ip = rng.choice(["192.0.2.150", "192.0.2.200", "192.0.2.211"])
            add(d * 1440 + rng.randint(0, 1439), rng.choice(["admin@dataguard.example", "root@dataguard.example", "test@dataguard.example"]),
                ip, rng.choice(ATTACK_UAS), False, "unknown_user", "ZZ", "Unknown (sample)", None, None, "scanner")

    # 2) brute-force bursts (T1110.001)
    for k, (d, ip) in enumerate([(12, "192.0.2.13"), (8, "192.0.2.27"), (4, "192.0.2.13"), (1, "192.0.2.101")]):
        target = accounts[(k * 7 + 3) % len(accounts)]
        start = d * 1440 + rng.randint(60, 1200)
        n = rng.randint(8, 15)
        cat = next(t[1] for t in THREATS if t[0] == ip)
        for j in range(n):
            add(start - j * 0.4, target, ip, ATTACK_UAS[k % 4], False, "locked" if j >= 5 else "bad_password",
                "ZZ", "Unknown (sample)", None, None, cat)
        alerts.append((start - 2, "brute_force", "T1110.001", "high", f"Brute-force attack on {target}",
                       f"{n} failed sign-ins in under 10 minutes from {ip} (on the sample threat list as '{cat}').",
                       target, ip, {"failures": n, "window_minutes": 10, "threat_category": cat}))
        alerts.append((start - 2, "account_lockout", "T1110", "medium", f"Account temporarily locked: {target}",
                       "The account was locked for 10 minutes after 5 consecutive failed sign-ins.",
                       target, ip, {"lock_minutes": 10}))

    # 3) password spraying (T1110.003): one IP, many accounts, one try each
    start = 6 * 1440 + 300
    victims = rng.sample(accounts, 12)
    for j, v in enumerate(victims):
        add(start - j * 0.6, v, "192.0.2.66", "python-requests/2.32.3", False, "bad_password", "ZZ", "Unknown (sample)", None, None,
            "credential_stuffing")
    alerts.append((start - 8, "password_spraying", "T1110.003", "high", "Password spraying from 192.0.2.66",
                   "12 different accounts tried from one IP address within 10 minutes.", None, "192.0.2.66",
                   {"distinct_accounts": 12, "window_minutes": 10}))

    # 4) impossible travel (T1078 Valid Accounts)
    for d, city in [(10, "Frankfurt"), (3, "Sao Paulo")]:
        a = accounts[d]
        p = profile[a]
        lat, lon = PH[p["city"]]
        m = d * 1440 + 600
        add(m, a, p["ip"], p["uas"][0], True, "ok", "PH", p["city"], lat, lon)
        cc, la2, lo2 = ABROAD[city]
        add(m - 45, a, "192.0.2.77" if d == 3 else "203.0.113.250", UAS[4], True, "ok", cc, city, la2, lo2,
            "tor_exit" if d == 3 else None)
        alerts.append((m - 45, "impossible_travel", "T1078", "high", f"Impossible travel for {a}",
                       f"Signed in from {p['city']}, PH and then {city}, {cc} 45 minutes later (~{10000 if d == 10 else 18000} km).",
                       a, "192.0.2.77" if d == 3 else "203.0.113.250", {"from": p["city"], "to": city, "minutes": 45}))
        if d == 3:
            alerts.append((m - 45, "threat_intel_match", "T1078", "critical", f"Successful sign-in from listed IP 192.0.2.77",
                           "A correct password was used from an IP on the SAMPLE threat-intel list (tor_exit).",
                           a, "192.0.2.77", {"threat_category": "tor_exit", "success": True}))

    # 5) new devices (low)
    for d in [13, 9, 5, 2, 0]:
        a = accounts[(d * 5 + 1) % len(accounts)]
        p = profile[a]
        lat, lon = PH[p["city"]]
        ua = next(u for u in UAS if u not in p["uas"])
        m = d * 1440 + 420
        add(m, a, p["ip"], ua, True, "ok", "PH", p["city"], lat, lon)
        alerts.append((m, "new_device", "T1078", "low", f"New device for {a}",
                       "First successful sign-in from this browser/device fingerprint.", a, p["ip"], {"device": dev(ua)}))

    out = ["-- AUTO-GENERATED by db/build_security_seed.py. SYNTHETIC sample data only (RFC 5737 IPs,",
           "-- .example e-mail domains, made-up locations). Idempotent: skipped if already loaded.", "BEGIN;"]
    out.append("INSERT INTO threat_intel (indicator, category, confidence, description, first_seen, last_seen) VALUES")
    out.append(",\n".join(f"({q(i)},{q(c)},{conf},{q(desc)},now() - interval '90 days',now() - interval '{k} days')"
                          for k, (i, c, conf, desc) in enumerate(THREATS)) + "\nON CONFLICT (indicator) DO NOTHING;")
    vals = []
    for (m, e, ip, ua, ok, reason, cc, city, lat, lon, threat) in rows:
        vals.append(f"({round(m, 1)},{q(e)},{q(ip)},{q(ua)},{q(dev(ua))},{q(ok)},{q(reason)},{q(cc)},{q(city)},{q(lat)},{q(lon)},{q(threat)})")
    out.append("INSERT INTO login_attempts (ts, email, ip, user_agent, device_hash, success, reason, country, city, lat, lon, threat_match, synthetic)")
    out.append("SELECT now() - make_interval(mins => v.m::int, secs => (v.m - floor(v.m)) * 60), v.e, v.ip, v.ua, v.dh, v.ok, v.reason, v.cc, v.city, v.lat::real, v.lon::real, v.threat, true FROM (VALUES")
    out.append(",\n".join(vals))
    out.append(") AS v(m, e, ip, ua, dh, ok, reason, cc, city, lat, lon, threat)")
    out.append("WHERE NOT EXISTS (SELECT 1 FROM login_attempts WHERE synthetic);")
    avals = [f"({m},{q(r)},{q(t)},{q(s)},{q(ti)},{q(de)},{q(e)},{q(ip)},{q(json.dumps(det))})"
             for (m, r, t, s, ti, de, e, ip, det) in alerts]
    out.append("INSERT INTO security_alerts (created_at, rule, technique_id, severity, title, description, email, ip, details, status, synthetic)")
    out.append("SELECT now() - make_interval(mins => v.m::int), v.r, v.t, v.s, v.ti, v.de, v.e, v.ip, v.det::jsonb,"
               " CASE WHEN v.m > 5 * 1440 THEN (CASE WHEN v.r = 'new_device' THEN 'false_positive' ELSE 'confirmed' END) ELSE 'flagged_for_review' END, true FROM (VALUES")
    out.append(",\n".join(avals))
    out.append(") AS v(m, r, t, s, ti, de, e, ip, det)")
    out.append("WHERE NOT EXISTS (SELECT 1 FROM security_alerts WHERE synthetic);")
    out.append("UPDATE security_alerts SET reviewed_at = created_at + interval '3 hours', review_note = 'Reviewed (synthetic sample).'"
               " WHERE synthetic AND status <> 'flagged_for_review' AND reviewed_at IS NULL;")
    out.append("COMMIT;")
    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(rows)} sign-in attempts, {len(alerts)} alerts, {len(THREATS)} threat indicators)")


if __name__ == "__main__":
    main()
