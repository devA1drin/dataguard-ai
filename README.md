# DataGuard AI

**An Intelligent Customer Data Protection and Corporate Accountability System Using Machine Learning**
**with a built-in Security Operations Center (SOC) for cybersecurity monitoring**

## What is this?

DataGuard AI is a working prototype of a privacy tool for a **made-up Philippine online store, "Acme Retail PH"**.
Customers use it to control how the store uses their personal data. The store's privacy and security
staff use it to spot employees who may be misusing customer data, manage incidents, and prove what
happened with a tamper-evident log. Machine learning (ML) helps by flagging suspicious activity,
explaining why, sorting incident reports, and answering customers' privacy questions from the store's
policy documents. On top of that it is a small **cybersecurity platform**: it watches sign-ins for
attacks (brute force, password spraying, impossible travel), maps every alert to **MITRE ATT&CK**, checks
links and e-mails for phishing, walks responders through incident **playbooks** with the Philippine
**NPC 72-hour breach-notification clock**, and grades its own security headers.
It is a capstone / portfolio project, and **every customer record in it is fake**.

**Try it live:** https://dataguard-ai-roan.vercel.app

**There are no shared demo logins.** Anyone can **sign up** for a *customer* account on the sign-up page.
Staff accounts (DPO, security analyst, admin, executive) cannot sign themselves up: an admin creates them
under *Users & roles*. The very first admin is created by the site owner (see [First admin](#first-admin)).

| SOC dashboard | Sign-in with two-step verification (MFA) | Incident playbook + NPC 72-hour clock |
|---|---|---|
| ![SOC dashboard with posture score, sign-in chart and live feed](docs/screenshots/soc-dashboard.png) | ![Login asking for a 6-digit authenticator code](docs/screenshots/login-mfa.png) | ![Incident page with a response checklist and a 72-hour countdown](docs/screenshots/incident-playbook.png) |

| DPO dashboard | Why an alert was raised (SHAP) | Privacy assistant |
|---|---|---|
| ![DPO dashboard with alert counts, trend chart and latest alerts](docs/screenshots/dashboard.png) | ![Alert detail with a SHAP bar chart of the reasons](docs/screenshots/alert-shap.png) | ![Customer privacy assistant answering with citations](docs/screenshots/privacy-assistant.png) |

> Looking for API endpoints, the database schema or the full ML methodology? See
> **[docs/TECHNICAL.md](docs/TECHNICAL.md)**.

## Contents

- [The problem it solves](#the-problem-it-solves)
- [How it works](#how-it-works)
- [Features](#features)
- [The machine learning, explained simply](#the-machine-learning-explained-simply)
- [Why synthetic data?](#why-synthetic-data)
- [Cybersecurity features](#cybersecurity-features)
- [Run it on your own computer](#run-it-on-your-own-computer)
- [First admin](#first-admin)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [Deploying to Vercel](#deploying-to-vercel)
- [Limitations](#limitations)
- [Future work](#future-work)
- [Glossary](#glossary)
- [Credits](#credits)

## The problem it solves

When you buy something online, the store keeps your name, address, phone number and order history.
Many employees can open that data, and most of them need it for their work. But what if one employee
quietly exports thousands of customer records at 2 a.m.? Or a customer asks, "Please stop sending me
promo texts," and nobody can show it was done?

Companies need answers to three questions:

1. **Are customers in control?** Can they see and change their consents, and ask for a copy, a correction or deletion of their data?
2. **Is anyone misusing the data?** Out of thousands of normal look-ups every day, which few deserve a closer look?
3. **Can we prove it?** If something goes wrong, is there a record of who did what that nobody can secretly edit?

DataGuard AI is a small, working answer to all three.

## How it works

```mermaid
flowchart LR
  U["You in a web browser"] --> FE["Frontend<br/>Next.js web pages"]
  FE -- "API calls with a session cookie" --> BE["Backend<br/>Express API"]
  BE -- "reads and writes" --> DB[("Database<br/>PostgreSQL")]
  BE -- "asks for predictions" --> ML["ML service<br/>FastAPI + Python models"]
```

The app has four parts. Each one runs as its own program.

| Part | What it does | Built with |
|---|---|---|
| **Frontend** | The pages you see: the customer portal and the staff console. It never touches the database directly. | Next.js (React), TypeScript |
| **Backend** | The "front desk." It checks who you are and what your role allows, saves changes, writes the audit log, and asks the ML service for predictions. | Express (Node.js), TypeScript |
| **ML service** | The "analyst." It loads the trained models and answers questions like "how unusual is this event?" Only the backend can call it. | FastAPI (Python), scikit-learn, SHAP |
| **Database** | Where everything is stored: users, consents, requests, access logs, alerts, incidents and the audit log. | PostgreSQL |

A few terms you will meet right away:

- **API (Application Programming Interface):** a set of web addresses that programs use to talk to each other. For example, the frontend sends `POST /api/auth/login` with your email and password, and the backend replies.
- **Session cookie:** after you log in, the backend stores a session on the server and gives your browser a random ID in an **httpOnly** cookie. JavaScript on the page can't read it, so a malicious script can't steal it. The browser sends it automatically, so the backend knows who you are and what your role is, such as customer or DPO.
- **Role-based access control (RBAC):** each role can only do certain things. For example, a customer who tries to open the staff console is sent back to the portal, and the API refuses the request.
- **Hash chain:** every important action is added to an audit log with a short "fingerprint" (a SHA-256 hash) that also includes the previous row's fingerprint. If anyone edits an old row later, every link after it stops matching, and *Verify hash chain* spots the change.

What happens when an employee opens customer data:

1. The access event is saved in the database.
2. The backend sends it to the ML service, which gives it a **risk score** from 0 to 1.
3. If the score is 0.5 or higher (the default threshold), the backend creates an **alert** marked *flagged for review*.
4. A DPO or security analyst opens the alert, reads the explanation, and decides: *confirmed* or *false positive*.
5. Every decision is written to the **hash-chained audit log**.

## Features

| Feature | What it does, in plain words | Where in the code |
|---|---|---|
| Sign-up, login and roles | Customers sign up themselves; staff are created by an admin. Each role only sees what it is allowed to | `backend/src/routes/auth.ts`, `backend/src/lib/auth.ts`, `frontend/src/app/signup` |
| Consent management | Customers switch each use of their data on or off (marketing email, SMS promos, and so on) and see the full history | `backend/src/routes/consents.ts`, `frontend/src/app/portal/consents` |
| Data-rights requests | Customers ask for a copy, a correction or deletion of their data; the DPO tracks and answers each request | `backend/src/routes/requests.ts`, `frontend/src/app/portal/requests`, `frontend/src/app/admin/requests` |
| Privacy assistant | Answers privacy questions by quoting the store's policy documents, and says "not covered" instead of guessing | `ml-service/app/rag.py`, `frontend/src/app/portal/assistant` |
| Anomaly alerts | Scores every employee access event and flags unusual ones for a person to review | `backend/src/jobs/scorer.ts`, `ml-service/app/main.py` |
| Alert explanations | Shows which details pushed the risk score up or down | `ml-service/app/main.py` (SHAP), `frontend/src/app/admin/alerts/[id]` |
| Simulate events | A button on *Access logs* that adds 5 fake access events and scores them on the spot, which is handy for live demos | `backend/src/routes/accessLogs.ts`, `frontend/src/app/admin/access-logs` |
| Incident management | Records incidents, suggests a category with ML, and tracks owners, status and corrective actions | `backend/src/routes/incidents.ts`, `frontend/src/app/admin/incidents` |
| Risk trend | Charts daily alerts or incidents with a 7-day average and a simple 14-day projection | `ml-service/app/forecast.py`, `frontend/src/app/admin/risk` |
| Model performance | Shows the models' test results honestly, including their mistakes | `ml-service/models/metrics.json`, `frontend/src/app/admin/models` |
| Audit log | Records every important action in a chain that reveals any later edit | `backend/src/lib/audit.ts`, `frontend/src/app/admin/audit` |
| Privacy in logs | Hides emails, phone numbers and tokens in server logs | `backend/src/lib/mask.ts` |
| User management | The admin creates staff accounts, changes roles, unlocks or deletes accounts | `backend/src/routes/users.ts`, `frontend/src/app/admin/users` |
| Demo mode | An optional frontend-only version with saved sample answers, so no server is needed | `frontend/src/lib/demo.ts`, `frontend/src/demo/fixtures.json` |

## The machine learning, explained simply

> All numbers below were measured on **synthetic (fake) data** made by `data/generate.py`. They show the
> system works end to end. They do **not** tell you how well it would work on a real company's data.

### 1. Spotting unusual data access (anomaly detection)

**Anomaly detection** means finding the few events that look very different from the rest. Nobody tells
the model which events are "bad"; it learns what normal looks like and flags what doesn't fit.

The model is an **Isolation Forest**. Picture playing "20 questions" to single out one event: "Was it
after 8 p.m.? Were more than 500 records opened?" A strange event gets isolated after only a few
questions, while a normal one needs many. The forest asks these random questions with 300 trees and
turns "isolated quickly" into a high risk score.

The model looks at the hour, the number of records and distinct customers opened, off-hours and weekend
flags, whether data was exported, failed logins, and the employee's role. It was trained on the first
60 days of fake logs and tested on the last 30 days: 2,718 events, of which 127 were planted anomalies.

| Measure | Result | What it means |
|---|---|---|
| Precision | **0.790** | When it raises an alert, it is right about 79 % of the time. |
| Recall | **0.890** | It catches about 89 % of the planted suspicious events (113 of 127). |
| F1 | **0.837** | One number that balances precision and recall (1.0 is perfect). |
| False-positive rate | **0.0116** | It wrongly flags about 1 in 86 normal events (30 of 2,591). |

It is best at off-hours bulk exports and credential misuse (recall 1.00 for both) and weakest at
"role mismatch" (0.72), because the model doesn't know which roles *should* see which data.

**SHAP (SHapley Additive exPlanations)** is a method that splits a prediction into "how much each
detail contributed." On every alert you see a bar chart. Red bars, such as *Records accessed = 1,332*,
pushed the score toward suspicious, and blue bars pushed it toward normal. This helps a person judge the
alert. It explains what the model reacted to, **not** what the employee intended.

### 2. Sorting incident reports (text classification)

When staff write an incident report, the system suggests one of 6 categories: unauthorized access,
data leak, phishing, misconfiguration, policy violation or lost device. The text is turned into numbers
with **TF-IDF** (explained below), and two models were compared on 180 test reports:

| Model | Accuracy | Macro F1 |
|---|---|---|
| Logistic Regression | 0.844 | 0.844 |
| Random Forest (used in the app) | **0.850** | **0.847** |

**Accuracy** is the share of reports put in the right category. **Macro F1** is the F1 score averaged
over the 6 categories, so small categories count as much as big ones. The two models are practically tied.
To keep the task realistic, 4 % of the training labels were deliberately made wrong. The suggestion is
advisory only, and a person confirms the final category.

### 3. Answering privacy questions (RAG)

**RAG (Retrieval-Augmented Generation)** means "first look up the relevant document, then answer from it."
This assistant **retrieves** the best-matching section of the 5 sample policy documents and quotes it with
a citation. It does not make up text.

- On the live site, matching uses **TF-IDF** (Term Frequency–Inverse Document Frequency). It scores words that are frequent in a section but rare elsewhere, such as "consent" or "retention," higher than common words.
- In the Docker version, it first tries a small embedding model (MiniLM + FAISS) that matches by meaning. If that isn't available, it falls back to TF-IDF automatically.
- If nothing matches well enough, or the question isn't about privacy (for example, "Who won the NBA finals?"), it answers that the question is **not covered by policy**.

For the full methodology, per-pattern results and the trend analysis, see [docs/TECHNICAL.md](docs/TECHNICAL.md#ml-methodology--evaluation).

## Cybersecurity features

Everything below is in the live (non-demo) version. Staff with the **security**, **DPO** or **admin** role
see a *Security operations* section in the menu; customers never see it and the API refuses them.

| Feature | What it does, in plain words | Where in the code |
|---|---|---|
| Safer sign-in | httpOnly + SameSite=Strict session cookie, a **CSRF** token on every change, passwords checked with **zxcvbn** (12+ characters, "hard to guess"), account **lockout** after 5 failures for 10 minutes and a per-IP limit | `backend/src/lib/auth.ts`, `backend/src/lib/password.ts`, `backend/src/routes/auth.ts` |
| Security headers | **helmet** on the API and a strict **Content Security Policy** (a fresh random *nonce* per page) on the website, plus anti-framing and other headers | `backend/src/app.ts`, `frontend/src/proxy.ts` |
| My security | Every user can turn on **MFA** (scan a QR code with Google Authenticator, Microsoft Authenticator, Aegis…), get 10 one-time **backup codes**, change their password, see where they are signed in and **sign out other sessions**, and review their sign-in history | `frontend/src/components/MySecurity.tsx`, `backend/src/lib/totp.ts` |
| SOC dashboard | Open alerts, failed sign-ins, a 14-day chart, the riskiest accounts and IP addresses, a live event feed and a **security posture score** (A–F) with tips | `frontend/src/app/admin/soc`, `backend/src/routes/soc.ts` |
| Threat monitoring | Every sign-in is checked by rules: brute force, password spraying, impossible travel, new device, lockout and matches against a **SAMPLE threat-intel list** (documentation-only IP ranges). A *Simulate brute-force attack* button shows it working | `backend/src/lib/detect.ts`, `frontend/src/app/admin/threats` |
| MITRE ATT&CK badges | Alerts and incidents show the matching ATT&CK technique (for example T1110.001 Password Guessing) with a link to attack.mitre.org | `frontend/src/lib/attack.ts` |
| Phishing detector | Paste a link or an e-mail and get a phishing probability with the top reasons. Trained on **synthetic** examples, with honest test scores on *Model performance* | `ml-service/training/train_phishing.py`, `frontend/src/app/admin/phishing` |
| Incident playbooks | Each incident category gets a 4-phase checklist (contain, eradicate, recover, lessons learned). Every tick is written to the audit log | `backend/src/lib/playbooks.ts`, `frontend/src/components/Playbook.tsx` |
| NPC 72-hour clock | Mark an incident as a personal-data breach and a countdown shows the time left to notify the National Privacy Commission (NPC Circular 16-03, Sec. 17) | `frontend/src/components/Playbook.tsx` |
| Security self-check | Scans the site's own HTTPS, headers and cookie flags and gives a grade with fixes | `backend/src/routes/selfcheck.ts`, `frontend/src/app/admin/self-check` |

**ATT&CK techniques used** (each ID checked on attack.mitre.org): T1110 Brute Force, T1110.001 Password
Guessing, T1110.003 Password Spraying, T1078 Valid Accounts, T1213 Data from Information Repositories,
T1567 Exfiltration Over Web Service, T1566 Phishing, T1530 Data from Cloud Storage.

**Phishing detector test scores (synthetic data, threshold 0.5):**

| Model | Precision | Recall | F1 | ROC AUC | Test examples |
|---|---|---|---|---|---|
| Links (URLs) | 0.965 | 0.936 | 0.951 | 0.958 | 1,000 |
| E-mails | 0.968 | 0.957 | 0.963 | 0.970 | 750 |

> **Honest note:** these examples come from templates in `train_phishing.py`, and the same templates
> appear in both the training and test sets. The scores show the model learned *these* patterns. They
> don't predict how it would do against a real phishing campaign, where accuracy would be lower.

## Why synthetic data?

**Synthetic data** is realistic-looking data generated by a program. Here, `data/generate.py` creates
400 fake customers, 60 fake employees, 90 days of access logs with planted suspicious events, and
900 incident reports. It uses a fixed random seed, so the results are the same every time.

We don't use real data because personal information is protected by law. In the Philippines, the
**Data Privacy Act of 2012 (Republic Act No. 10173)** requires a lawful basis, proper safeguards and
respect for people's rights over their data. A student project has no reason to handle real people's
records. Synthetic data lets us build and test everything safely. The policy documents in
`data/policies/` are fictional samples that mention the law only in general terms, and they are **not legal advice**.

## Run it on your own computer

The easiest way is **Docker**, which runs all four parts with one command.

### What you need

- **Git**, to download the code: https://git-scm.com/downloads
- **Docker Desktop**, to run everything: https://www.docker.com/products/docker-desktop/ (on Linux you can use Docker Engine with the Compose plugin instead)
- Optional, only if you want to run the parts without Docker:
  - **Node.js 20 or newer:** https://nodejs.org/
  - **Python 3.11 or newer:** https://www.python.org/downloads/
  - **PostgreSQL 14 or newer:** https://www.postgresql.org/download/

### Steps

1. **Open a terminal.** On Windows, use PowerShell or Git Bash. On macOS or Linux, use Terminal.
2. **Download the project:**
   ```bash
   git clone https://github.com/devA1drin/dataguard-ai.git
   cd dataguard-ai
   ```
3. **Create your settings file** by copying the example:
   ```bash
   cp .env.example .env
   ```
   On Windows PowerShell, use `copy .env.example .env`. Then open `.env`, change `JWT_SECRET` to any long random text,
   and set `ADMIN_EMAIL` to **your** e-mail address (this is how you become the first admin).
4. **Start Docker Desktop** and wait until it says it is running.
5. **Build and start everything:**
   ```bash
   docker compose up --build
   ```
   The first run takes several minutes because it downloads the base images and Python packages (including PyTorch) and trains the models. Leave this terminal open.
6. **Open the app** at http://localhost:3000, click **Create an account** and sign up with the `ADMIN_EMAIL` address.
   Because no admin exists yet, that account becomes the admin. Everyone else who signs up becomes a customer.

What you should see:

| Address | What's there |
|---|---|
| http://localhost:3000 | The DataGuard AI login page |
| http://localhost:4000/api/health | `{"status":"ok","db":"ok","runtime":"server"}` |
| http://localhost:8000/docs | The ML service's interactive API page (Swagger UI) |

After start-up, the backend scores the roughly 1,900 seeded access events, which creates about 100 alerts.
A simulator then adds a fake access event every 20 seconds, so new alerts keep appearing.

- **To stop:** press `Ctrl + C` in the terminal.
- **To delete all data and start fresh:** run `docker compose down -v`.

> **Honest note:** the full Docker setup was tested end to end before the project was adapted for Vercel.
> Those changes touched the ML Dockerfile (its Python packages are now split into `requirements.txt` +
> `requirements-extras.txt`) and the backend entry files. The compose file still validates
> (`docker compose config`) and the backend still compiles, but a full `docker compose up --build`
> **has not been re-run since**, because Docker wasn't available on the machine used for those changes.
> If something fails, please open an issue.

To run each part without Docker, see [Running without Docker](docs/TECHNICAL.md#running-without-docker).

## First admin

There are no built-in passwords, so the site owner creates the first admin in one of two ways:

- **Option A: `ADMIN_EMAIL`.** Set the environment variable `ADMIN_EMAIL=you@example.com` (in `.env`, or in
  the Vercel project settings), then sign up on the website with exactly that address. While **no admin exists
  yet**, that sign-up becomes the admin. After the first admin exists, the variable does nothing, so nobody can
  use it later to take over.
- **Option B: the command line.** From the `backend` folder, with `DATABASE_URL` pointing at your database:
  ```bash
  cd backend
  npm run create-admin                    # asks for e-mail, name and a password (typed hidden)
  npm run create-admin -- you@example.com # or give the e-mail directly
  ```
  With Docker: `docker compose exec backend npm run create-admin:prod`.
  If the e-mail already belongs to a staff account, it is promoted to admin and gets the new password.

Then sign in, open **My security** and turn on MFA. Create other staff accounts under **Users & roles**.

> **Not included:** e-mail verification and "forgot password" e-mails. They need an e-mail sending service,
> which this free prototype doesn't have. If someone forgets their password, an admin can delete the account so
> they can be re-created; `npm run create-admin` can also set a new password for an admin.

## Troubleshooting

| Problem | What to try |
|---|---|
| `Cannot connect to the Docker daemon` or `docker: command not found` | Start Docker Desktop and wait until it is running, then try again. On Linux, run `sudo systemctl start docker`, or add your user to the `docker` group. |
| `port is already allocated` / `address already in use` (3000, 4000, 8000 or 5432) | Another program is using that port, often a local PostgreSQL on 5432 or another dev server on 3000. Stop it, or change the left-hand number of that `ports:` line in `docker-compose.yml`, for example `"5433:5432"`. |
| `cp: command not found` on Windows | Use `copy .env.example .env` in PowerShell, or run the command in Git Bash. |
| The build stops while installing Python packages | Check your internet connection, then run `docker compose build --no-cache ml-service` and start again. |
| "Too many failed sign-ins" / account locked | Wait 10 minutes, or ask an admin to click **Unlock** under *Users & roles*. |
| I can't sign in to the staff console | Staff accounts can't sign up. Create the first admin (see [First admin](#first-admin)); other staff are created by an admin. |
| The page loads but login fails | Wait until the backend log says it is listening. It waits for the database and ML service to be healthy first. Check http://localhost:4000/api/health. |
| No alerts or empty charts | Give the backend a minute to score the seeded events, then refresh. |
| You want a clean start | Run `docker compose down -v`, then `docker compose up --build`. |

## Project structure

```
dataguard-ai/
├── frontend/          Web pages: customer portal (src/app/portal) and staff console (src/app/admin)
├── backend/           Express API: login, roles, routes, audit log, scoring job (src/)
├── ml-service/        Python ML service: API (app/), training scripts (training/), trained models (models/)
│   └── policies/      Copy of the policy documents bundled for the Vercel deployment
├── data/              Synthetic data generator (generate.py) and sample policy documents (policies/)
├── db/                Database schema (init.sql) and demo seed data (seed.sql, built by build_seed.py)
├── docs/              Technical reference (TECHNICAL.md) and screenshots
├── scripts/           Playwright scripts for screenshots and live end-to-end checks
├── docker-compose.yml Runs all four parts locally with Docker
├── vercel.json        Tells Vercel how to deploy the three services together
└── .env.example       Template for your local settings (copy to .env)
```

## Deploying to Vercel

The live site runs on **Vercel**, a hosting platform. One Vercel project hosts the frontend, the backend
and the ML service as three "services" listed in `vercel.json`. The database is a free **Neon Postgres**
database added from the Vercel Marketplace.

In short:

1. Install the Vercel CLI (`npm i -g vercel`), run `vercel login`, then run `vercel link` in the project folder.
2. Add a Neon Postgres database to the project from the Vercel dashboard (Storage → Marketplace). This sets `DATABASE_URL`.
3. Load `db/init.sql`, `db/seed.sql`, then `db/migrations/002_security.sql`, `003_security_seed.sql` and `004_remove_demo_accounts.sql` into that database (each migration is additive and safe to re-run).
4. Set these environment variables:
   - `JWT_SECRET` and `CRON_SECRET`: long random strings
   - `ADMIN_EMAIL`: your e-mail, to create the first admin (optional `MFA_ENC_KEY`)
   - `NEXT_PUBLIC_API_URL=/`
   - `NEXT_PUBLIC_ALERT_TRANSPORT=poll`
   - `NEXT_PUBLIC_DEMO_MODE=false`
   - `RAG_BACKEND=tfidf`
   - `SIMULATE_ACCESS_LOGS=false`
5. Run `vercel deploy --prod`, then sign up with your `ADMIN_EMAIL` (see [First admin](#first-admin)).

On Vercel there are no always-running background jobs. Events are scored as they arrive, a daily scheduled
job (a Vercel Cron) scores anything left over, and the browser checks for new alerts every 15 seconds.
Full details are in [docs/TECHNICAL.md](docs/TECHNICAL.md#live-deployment-on-vercel).

## Limitations

- **Fake data, optimistic numbers.** The suspicious events were planted by the same program that defines "normal," so real misuse would be harder to catch.
- **Models don't learn over time.** Nothing retrains automatically or detects when behavior changes.
- **Simple trend line.** The risk projection is a straight-line fit, not a real forecast.
- **Small policy set.** The assistant knows only 5 short sample documents.
- **Prototype-level security.** MFA, lockout, CSRF and a strict CSP are in place, but there is no e-mail verification or "forgot password" e-mail, and the style policy still allows inline styles (needed by the charts). A locked account tells the visitor it is locked, which reveals that the account exists.
- **Sample threat intel.** The threat-intel list is a SAMPLE using documentation-only IP ranges, not a real feed. Locations of sign-ins are approximate placeholders.
- **Synthetic phishing data.** The phishing models have never seen a real phishing campaign.
- **Audit chain limits.** The chain reveals edits, but a database superuser could rewrite the whole chain.
- **Requests are tracked, not executed.** Data-rights requests are tracked, but data is not exported or deleted automatically.
- **Few automated tests.** Checks are scripted API calls and browser runs; there are no unit tests yet.

The full list is in [docs/TECHNICAL.md](docs/TECHNICAL.md#limitations).

## Future work

- Use reviewers' decisions to tune the alert threshold, and retrain models regularly.
- Compare each employee with similar co-workers (peer-group baselines).
- Add e-mail verification and password-reset e-mails, and WebAuthn passkeys.
- Connect a real threat-intel feed and an IP-geolocation database.
- Train the phishing detector on a licensed public corpus and test it on unseen campaigns.
- Automate data exports and deletions for data-rights requests.
- Add unit and integration tests that run automatically (CI).
- Grow the policy library and build a proper test set for the assistant.

## Glossary

| Term | Meaning |
|---|---|
| **Anomaly detection** | Finding the few items that look very different from the rest. |
| **API** | A set of web addresses that programs use to send requests and get answers. |
| **Audit log** | A record of who did what and when. |
| **ATT&CK (MITRE ATT&CK)** | A free public catalogue of the techniques real attackers use, each with an ID such as T1110 (Brute Force). Security teams use the IDs as a shared language. |
| **Brute force** | Guessing a password by trying many passwords on one account. *Password spraying* is the reverse: one common password tried on many accounts. |
| **Content Security Policy (CSP)** | A rule list the website sends to the browser saying which scripts and connections are allowed, so injected code can't run. |
| **Cookie (httpOnly)** | A small value the browser stores and sends back automatically. *httpOnly* means page scripts can't read it. |
| **CSRF** | Cross-Site Request Forgery: a different website tricking your browser into making a request to this one. A secret CSRF token on every change blocks it. |
| **Consent** | A customer's permission for a specific use of their data, such as marketing emails. |
| **Data Protection Officer (DPO)** | The person in a company responsible for privacy compliance. |
| **F1 score** | One number combining precision and recall; 1.0 is perfect. |
| **False positive** | An alert on something that was actually normal. |
| **Hash** | A short "fingerprint" of data (here SHA-256). Changing even one letter of the data changes the fingerprint completely. |
| **Hash chain** | Each audit entry's fingerprint also includes the previous entry's fingerprint, so editing an old entry breaks every link after it. *Verify hash chain* re-checks all links. |
| **Isolation Forest** | An anomaly-detection model that flags events that are easy to "isolate" with a few random yes/no questions. |
| **JWT** | A signed token that proves who someone is. This project now uses server-side sessions instead, so a sign-in can be revoked instantly. |
| **Lockout** | Temporarily blocking an account after too many wrong passwords, to stop brute force. |
| **MFA (multi-factor authentication)** | Signing in with something you know (password) **and** something you have (a 6-digit code from an authenticator app). A stolen password alone is no longer enough. |
| **NPC** | The National Privacy Commission of the Philippines, which enforces the Data Privacy Act. Serious personal-data breaches must be reported to it within 72 hours. |
| **Phishing** | A fake message or website that tricks people into giving away passwords or money. |
| **Playbook** | A step-by-step checklist for handling one type of incident. |
| **Machine learning (ML)** | Programs that learn patterns from example data instead of following hand-written rules. |
| **Precision** | Of the alerts raised, the share that were truly suspicious. |
| **RAG** | Retrieval-Augmented Generation: look up relevant documents first, then answer from them. |
| **Recall** | Of the truly suspicious events, the share that were caught. |
| **RBAC** | Role-based access control: permissions depend on your role. |
| **Session** | The server's record that you are signed in. Signing out (or "sign out other sessions") deletes it. |
| **SHAP** | A method that shows how much each input detail pushed a prediction up or down. |
| **SOC (Security Operations Center)** | The team, and the dashboard, that watches for attacks and responds to them. |
| **Synthetic data** | Realistic but fake data generated by a program. |
| **Threat intelligence** | Lists of known-bad IP addresses, domains, etc. Here it is a SAMPLE list for teaching. |
| **TF-IDF** | A way to turn text into numbers that gives more weight to distinctive words. |

## Credits

Built as a capstone / portfolio project. It uses open-source tools including Next.js, React, Express,
FastAPI, scikit-learn, SHAP, PostgreSQL, zxcvbn, helmet, qrcode and Playwright. ATT&CK® is a registered trademark of The MITRE Corporation. All names, customers, employees and policies
are fictional. The project is hosted on Vercel with a Neon Postgres database.
