"""
DataGuard AI - Synthetic data generator.

Everything produced here is FAKE. It is generated with a fixed random seed so
results are reproducible. No real customer data is used anywhere in the project.

Outputs (written to data/generated/):
  customers.csv      - fictional customers of the sample company "Acme Retail PH"
  consents.csv       - consent records per customer and purpose
  employees.csv      - fictional employees who access customer data
  access_logs.csv    - employee access events, with injected anomalies
                       (column `is_anomaly` / `anomaly_type` are ground-truth
                       labels used ONLY for evaluation, never as model input)
  incidents.csv      - free-text incident reports with category labels
  daily_counts.csv   - daily incident / anomaly counts for risk trend analysis

Usage:  python data/generate.py [--seed 42]
"""
from __future__ import annotations

import argparse
import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent / "generated"

FIRST = ["Juan", "Maria", "Jose", "Ana", "Mark", "Kristine", "John Paul", "Angelica", "Paolo",
         "Camille", "Miguel", "Patricia", "Carlo", "Bea", "Rafael", "Joy", "Enrico", "Liza",
         "Ramon", "Grace", "Dennis", "Aileen", "Nico", "Trisha", "Jerome", "Kaye"]
LAST = ["Santos", "Reyes", "Cruz", "Bautista", "Garcia", "Mendoza", "Torres", "Flores",
        "Villanueva", "Ramos", "Aquino", "Castillo", "Dela Cruz", "Navarro", "Gonzales",
        "Lopez", "Fernandez", "Morales", "Domingo", "Pascual"]
CITIES = ["Quezon City", "Manila", "Makati", "Pasig", "Taguig", "Cebu City", "Davao City",
          "Iloilo City", "Baguio", "Cagayan de Oro", "Bacolod", "Antipolo"]
PURPOSES = ["marketing_email", "sms_promotions", "personalized_recommendations",
            "third_party_sharing", "analytics"]
# Roles of *employees* who access customer data (not app login roles)
EMP_ROLES = ["support_agent", "marketing", "analyst", "it_admin", "finance"]
# Normal behaviour profile per role: (mean records, mean distinct customers, export prob)
ROLE_PROFILE = {
    "support_agent": (6, 4, 0.01),
    "marketing": (25, 18, 0.05),
    "analyst": (60, 40, 0.10),
    "it_admin": (10, 3, 0.03),
    "finance": (15, 10, 0.04),
}
RESOURCES = ["customer_profile", "order_history", "payment_info", "contact_details", "loyalty_points"]

CATEGORIES = ["unauthorized_access", "data_leak", "phishing", "misconfiguration",
              "policy_violation", "lost_device"]

# Template fragments per incident category. The generator mixes these with
# shared "noise" sentences so the text classifier has a realistic (not trivial) task.
INCIDENT_TEMPLATES = {
    "unauthorized_access": [
        "An employee account from {dept} accessed {n} customer profiles outside their assigned queue.",
        "Login to the CRM was recorded from an unrecognized location using {who}'s credentials.",
        "A contractor viewed payment records without an approved ticket.",
        "Several failed login attempts followed by a successful login on the admin console were detected.",
        "A former staff member's account was still active and was used to open customer records.",
        "Someone used a shared password to enter the loyalty database without authorization.",
    ],
    "data_leak": [
        "A spreadsheet containing {n} customer contact details was found on a public file-sharing link.",
        "Customer emails and phone numbers were posted in an online forum, apparently from our export.",
        "An email with an attachment of order history was sent to the wrong external recipient.",
        "A partner reported receiving a file with unmasked customer addresses.",
        "Internal report with customer names was uploaded to a personal cloud drive and shared publicly.",
        "Screenshots of customer records appeared in a social media group chat.",
    ],
    "phishing": [
        "{who} received an email pretending to be from IT asking to reset their password via a link.",
        "Staff reported a suspicious message impersonating the CEO requesting gift card purchases.",
        "A fake login page mimicking our HR portal was sent to {n} employees.",
        "Customers reported SMS messages claiming to be from Acme Retail asking for OTP codes.",
        "An employee clicked a link in a fraudulent invoice email and entered credentials.",
        "A spoofed domain sent emails asking staff to verify payroll information.",
    ],
    "misconfiguration": [
        "A storage bucket holding backups was set to public read access by mistake.",
        "The staging database was exposed to the internet without a firewall rule.",
        "Access permissions on the reports folder were set to everyone in the company.",
        "Debug logging was left on in production and wrote full customer records to log files.",
        "An API endpoint returned more fields than intended after a deployment.",
        "TLS certificate expired and the customer portal briefly served pages over plain HTTP.",
    ],
    "policy_violation": [
        "{who} exported customer lists for a marketing campaign without checking consent status.",
        "Customer data was retained beyond the documented retention period of the {dept} team.",
        "Staff sent customer details through a personal messaging app against company policy.",
        "A team used customer purchase data for a purpose not covered by the privacy notice.",
        "Printed customer forms were left unattended on a desk overnight.",
        "Marketing SMS was sent to customers who had withdrawn their consent.",
    ],
    "lost_device": [
        "{who} reported a company laptop lost in a taxi; it may contain customer reports.",
        "A mobile phone with access to the CRM app was stolen at a mall.",
        "An unencrypted USB drive with order exports went missing from the {dept} office.",
        "A tablet used for in-store sign-ups was misplaced during inventory.",
        "A backup hard drive could not be located after an office move.",
        "An employee left their work phone in a restaurant and it was not recovered.",
    ],
}
NOISE = [
    "Reported by the {dept} team on {day}.",
    "The incident was escalated to the DPO for review.",
    "Initial assessment is ongoing.",
    "No confirmation yet whether customer data was affected.",
    "The affected systems were noted in the ticket.",
    "IT security was notified immediately.",
    "Further details to follow after investigation.",
    "This may require notification depending on impact.",
]
DEPTS = ["Customer Service", "Marketing", "Finance", "IT", "Logistics", "Store Operations", "HR"]


def rand_name(rng: random.Random) -> str:
    return f"{rng.choice(FIRST)} {rng.choice(LAST)}"


def gen_customers(rng, n=400):
    rows = []
    for i in range(1, n + 1):
        name = rand_name(rng)
        email = name.lower().replace(" ", ".") + f"{i}@example.ph"  # example.ph -> clearly fake
        phone = "+63 9" + "".join(str(rng.randint(0, 9)) for _ in range(9))
        rows.append({"customer_id": i, "full_name": name, "email": email, "phone": phone,
                     "city": rng.choice(CITIES),
                     "created_at": (datetime(2025, 1, 1) + timedelta(days=rng.randint(0, 500))).date().isoformat()})
    return rows


def gen_consents(rng, customers):
    rows = []
    for c in customers:
        for p in PURPOSES:
            base = {"marketing_email": 0.6, "sms_promotions": 0.4, "personalized_recommendations": 0.55,
                    "third_party_sharing": 0.15, "analytics": 0.7}[p]
            rows.append({"customer_id": c["customer_id"], "purpose": p,
                         "granted": rng.random() < base})
    return rows


def gen_employees(rng, n=60):
    rows = []
    for i in range(1, n + 1):
        role = rng.choices(EMP_ROLES, weights=[40, 15, 15, 15, 15])[0]
        rows.append({"employee_id": f"E{i:03d}", "name": rand_name(rng), "role": role})
    return rows


def gen_access_logs(rng, nrng, employees, n_customers, days=90, per_day=110, anomaly_rate=0.04):
    """Normal behaviour: work-hours access, small record counts tied to role.
    Injected anomalies (labelled) follow several realistic patterns."""
    start = datetime(2026, 7, 1)
    rows = []
    lid = 1
    for d in range(days):
        day = start + timedelta(days=d)
        weekend = day.weekday() >= 5
        n_events = int(per_day * (0.45 if weekend else 1.0) * nrng.uniform(0.85, 1.15))
        for _ in range(n_events):
            emp = rng.choice(employees)
            role = emp["role"]
            mean_rec, mean_dist, p_exp = ROLE_PROFILE[role]
            hour = int(np.clip(nrng.normal(13, 2.4), 7, 19))
            records = max(1, int(nrng.poisson(mean_rec)))
            distinct = max(1, min(records, int(nrng.poisson(mean_dist))))
            export = rng.random() < p_exp
            failed = int(nrng.poisson(0.1))
            anomaly_type = ""
            if rng.random() < anomaly_rate:
                anomaly_type = rng.choice(["bulk_export_offhours", "mass_lookup", "credential_misuse",
                                           "role_mismatch", "slow_exfiltration"])
                if anomaly_type == "bulk_export_offhours":
                    hour = rng.choice([0, 1, 2, 3, 4, 22, 23])
                    records = int(nrng.uniform(300, 2500)); distinct = int(records * nrng.uniform(0.6, 1.0)); export = True
                elif anomaly_type == "mass_lookup":
                    records = int(nrng.uniform(200, 900)); distinct = int(records * nrng.uniform(0.8, 1.0))
                elif anomaly_type == "credential_misuse":
                    hour = rng.choice([1, 2, 3, 23, 5]); failed = rng.randint(4, 12)
                    records = int(nrng.uniform(20, 120)); distinct = int(records * 0.9)
                elif anomaly_type == "role_mismatch":
                    # e.g. support agent pulling payment info and exporting
                    role = "support_agent"; export = True
                    records = int(nrng.uniform(80, 300)); distinct = int(records * 0.9)
                elif anomaly_type == "slow_exfiltration":
                    # subtle: moderate volume, export, slightly off-hours -> harder to detect
                    hour = rng.choice([6, 19, 20, 21]); export = True
                    records = int(nrng.uniform(40, 120)); distinct = int(records * nrng.uniform(0.5, 0.9))
            minute = rng.randint(0, 59)
            ts = day.replace(hour=hour, minute=minute, second=rng.randint(0, 59))
            off_hours = int(hour < 7 or hour >= 20 or weekend)
            rows.append({
                "log_id": lid, "timestamp": ts.isoformat(), "employee_id": emp["employee_id"],
                "role": role, "resource": "payment_info" if anomaly_type == "role_mismatch" else rng.choice(RESOURCES),
                "customer_id": rng.randint(1, n_customers),
                "hour_of_day": hour, "records_accessed": records, "distinct_customers": distinct,
                "off_hours": off_hours, "is_weekend": int(weekend), "export_flag": int(export),
                "failed_logins": failed,
                "is_anomaly": int(bool(anomaly_type)), "anomaly_type": anomaly_type,
            })
            lid += 1
    rows.sort(key=lambda r: r["timestamp"])
    return rows


def gen_incidents(rng, n=900, label_noise=0.04):
    rows = []
    start = datetime(2026, 7, 1)
    for i in range(1, n + 1):
        cat = rng.choice(CATEGORIES)
        parts = [rng.choice(INCIDENT_TEMPLATES[cat])]
        if rng.random() < 0.35:  # occasionally a second sentence from another category -> ambiguity
            parts.append(rng.choice(INCIDENT_TEMPLATES[rng.choice(CATEGORIES)]))
        parts.extend(rng.sample(NOISE, k=rng.randint(1, 3)))
        rng.shuffle(parts)
        text = " ".join(parts).format(dept=rng.choice(DEPTS), n=rng.randint(3, 5000),
                                      who=rand_name(rng), day=(start + timedelta(days=rng.randint(0, 89))).date())
        label = cat if rng.random() > label_noise else rng.choice(CATEGORIES)  # simulated annotation noise
        day = start + timedelta(days=int(min(89, rng.triangular(0, 89, 70))))  # slight upward trend
        rows.append({"incident_id": i, "reported_at": day.date().isoformat(), "description": text,
                     "category": label})
    return rows


def daily_counts(logs, incidents):
    from collections import Counter
    a = Counter(r["timestamp"][:10] for r in logs if r["is_anomaly"])
    t = Counter(r["timestamp"][:10] for r in logs)
    inc = Counter(r["reported_at"] for r in incidents)
    days = sorted(set(t))
    return [{"date": d, "access_events": t[d], "anomalies": a.get(d, 0), "incidents": inc.get(d, 0)} for d in days]


def write(name, rows):
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    print(f"  wrote {name:18s} {len(rows):6d} rows")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    nrng = np.random.default_rng(args.seed)
    print("Generating synthetic data (seed=%d) ..." % args.seed)
    customers = gen_customers(rng)
    employees = gen_employees(rng)
    logs = gen_access_logs(rng, nrng, employees, len(customers))
    incidents = gen_incidents(rng)
    write("customers.csv", customers)
    write("consents.csv", gen_consents(rng, customers))
    write("employees.csv", employees)
    write("access_logs.csv", logs)
    write("incidents.csv", incidents)
    write("daily_counts.csv", daily_counts(logs, incidents))


if __name__ == "__main__":
    main()
