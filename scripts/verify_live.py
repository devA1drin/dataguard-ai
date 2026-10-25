"""End-to-end check of a LIVE (non-demo) DataGuard AI deployment, with 1440px screenshots.

Usage: pip install playwright && playwright install chromium
       DG_ADMIN_EMAIL=you@example.com DG_ADMIN_PASSWORD='...' [DG_ADMIN_TOTP_SECRET=...] \
       python scripts/verify_live.py https://your-site.example [out_dir]

There are NO shared demo accounts. The script
  * signs up a fresh throwaway CUSTOMER (verify.<timestamp>@example.com, random password), and
  * signs in with YOUR admin account from the env vars above (the TOTP secret is only needed
    if that admin has MFA turned on; codes are computed locally, nothing is printed).
Delete the throwaway customer afterwards under Users & roles. Synthetic data only."""
import base64
import hashlib
import hmac
import os
import re
import secrets
import struct
import sys
import time
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
OUT = (sys.argv[2] if len(sys.argv) > 2 else "screenshots/live") + "/"
ADMIN_EMAIL = os.environ.get("DG_ADMIN_EMAIL", "")
ADMIN_PW = os.environ.get("DG_ADMIN_PASSWORD", "")
TOTP_SECRET = os.environ.get("DG_ADMIN_TOTP_SECRET", "").replace(" ", "")
if not ADMIN_EMAIL or not ADMIN_PW:
    sys.exit("Set DG_ADMIN_EMAIL and DG_ADMIN_PASSWORD (see README > First admin).")
CUST_EMAIL = f"verify.{int(time.time())}@example.com"
CUST_PW = "Verify-" + secrets.token_urlsafe(18)
results = []


def totp(secret):
    key = base64.b32decode(secret.upper() + "=" * ((8 - len(secret) % 8) % 8))
    h = hmac.new(key, struct.pack(">Q", int(time.time()) // 30), hashlib.sha1).digest()
    o = h[-1] & 15
    return "%06d" % ((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000)


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f" - {detail}" if detail else ""))


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=["--no-sandbox"] if os.environ.get("CHROME_PATH") else [])
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    errors = []
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))

    def shot(name, wait=800):
        pg.wait_for_timeout(wait)
        pg.screenshot(path=OUT + name, full_page=True)
        print("  saved", OUT + name)

    def logout():
        ctx.clear_cookies()

    def login(email, pw):
        logout()
        pg.goto(BASE + "/login", wait_until="networkidle")
        pg.fill("input[type=email]", email)
        pg.fill("input[type=password]", pw)
        pg.get_by_role("button", name="Sign in").click()
        try:
            pg.wait_for_selector("text=Two-step verification", timeout=5000)
        except Exception:
            return
        if not TOTP_SECRET:
            sys.exit("This admin has MFA on: set DG_ADMIN_TOTP_SECRET")
        pg.fill("input[autocomplete=one-time-code]", totp(TOTP_SECRET))
        pg.get_by_role("button", name=re.compile("Verify")).click()

    # --- login page is the real (non-demo) form
    pg.goto(BASE + "/login", wait_until="networkidle")
    check("login page shows password form (demo mode off)", pg.locator("input[type=password]").count() == 1)
    shot("01-login.png", 300)

    # --- customer: public sign-up always creates a CUSTOMER
    logout()
    pg.goto(BASE + "/signup", wait_until="networkidle")
    pg.fill("input[autocomplete=name]", "Verify Script (throwaway)")
    pg.fill("input[type=email]", CUST_EMAIL)
    pg.locator("input[type=password]").nth(0).fill(CUST_PW)
    pg.locator("input[type=password]").nth(1).fill(CUST_PW)
    pg.get_by_role("button", name="Create account").click()
    pg.wait_for_url("**/portal/**", timeout=30000)
    check("sign-up -> customer portal", "/portal" in pg.url, CUST_EMAIL)
    shot("02-customer-after-signup.png")
    pg.goto(BASE + "/portal/assistant", wait_until="networkidle")
    pg.fill("input[placeholder^='e.g.']", "How do I withdraw my marketing consent?")
    pg.get_by_role("button", name="Ask", exact=True).click()
    pg.wait_for_selector("text=Sources", timeout=60000)
    check("assistant answers on-topic question with sources", True)
    pg.fill("input[placeholder^='e.g.']", "Who won the NBA finals last year?")
    pg.get_by_role("button", name="Ask", exact=True).click()
    pg.wait_for_selector("text=Not covered by policy", timeout=60000)
    check("assistant refuses off-topic question", True)
    shot("04-customer-privacy-assistant.png")
    pg.goto(BASE + "/admin", wait_until="networkidle")
    pg.wait_for_timeout(2500)
    blocked = "/admin" not in pg.url or pg.locator("text=Security overview").count() == 0
    check("customer blocked from /admin", blocked, pg.url)

    # --- staff (your admin account)
    login(ADMIN_EMAIL, ADMIN_PW)
    pg.wait_for_url(re.compile(r".*/admin$"), timeout=30000)
    pg.wait_for_timeout(3000)
    check("admin login -> dashboard", pg.url.endswith("/admin"), pg.url)
    shot("05-admin-dashboard-live.png", 2500)

    pg.goto(BASE + "/admin/access-logs", wait_until="networkidle")
    pg.get_by_role("button", name=re.compile("Simulate")).click()
    pg.wait_for_selector("text=Inserted", timeout=120000)
    txt = pg.locator("text=Inserted").first.inner_text()
    check("simulate: events inserted + scored", "scored" in txt, txt[:160])
    shot("06-admin-access-logs-simulated.png", 600)
    link = pg.locator("a[href^='/admin/alerts/']").first
    if link.count():
        href = link.get_attribute("href")
        check("simulate created a new alert", True, href)
        pg.goto(BASE + href, wait_until="networkidle")
        pg.wait_for_timeout(2000)
        check("alert detail shows SHAP explanation", pg.locator("text=Main factors").count() > 0)
        shot("07-admin-alert-detail-shap-live.png", 800)
        pg.get_by_role("button", name=re.compile("Confirm suspicious")).click()
        pg.wait_for_timeout(3000)
        check("alert reviewed (confirmed) in UI", pg.locator("text=/confirmed/i").count() > 0)
    else:
        check("simulate created a new alert", False)

    pg.goto(BASE + "/admin/incidents", wait_until="networkidle"); pg.wait_for_timeout(2000)
    shot("09-admin-incidents-live.png")
    pg.goto(BASE + "/admin/models", wait_until="networkidle"); pg.wait_for_timeout(2500)
    check("model performance page loads metrics", pg.locator("text=/Isolation Forest|IsolationForest/i").count() > 0)
    shot("11-admin-model-performance-live.png", 800)
    pg.goto(BASE + "/admin/audit", wait_until="networkidle"); pg.wait_for_timeout(2500)
    btn = pg.get_by_role("button", name=re.compile("Verify", re.I))
    if btn.count():
        btn.first.click(); pg.wait_for_timeout(3000)
    check("audit chain verifies in UI", pg.locator("text=/intact|valid|verified/i").count() > 0)
    shot("12-admin-audit-log-live.png", 500)

    pg.goto(BASE + "/admin/soc", wait_until="networkidle"); pg.wait_for_timeout(2500)
    check("SOC dashboard loads", pg.locator("text=Security posture").count() > 0)
    shot("13-admin-soc-live.png", 500)
    print(f"throwaway customer created: {CUST_EMAIL} - delete it under Users & roles")
    print("console errors:", len(errors), errors[:5])
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
