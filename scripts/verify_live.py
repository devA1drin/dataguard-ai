"""End-to-end check of a LIVE (non-demo) DataGuard AI deployment, with 1440px screenshots.
Usage: pip install playwright && playwright install chromium
       python scripts/verify_live.py https://dataguard-ai-roan.vercel.app [out_dir]
Uses the seeded demo accounts (password DemoPass123!, synthetic data only)."""
import re
import sys
from playwright.sync_api import sync_playwright, expect

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
OUT = (sys.argv[2] if len(sys.argv) > 2 else "screenshots/live") + "/"
PW = "DemoPass123!"
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f" - {detail}" if detail else ""))


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    errors = []
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))

    def shot(name, wait=800):
        pg.wait_for_timeout(wait)
        pg.screenshot(path=OUT + name, full_page=True)
        print("  saved", OUT + name)

    def login(email):
        pg.goto(BASE + "/login", wait_until="networkidle")
        pg.evaluate("localStorage.clear()")
        pg.goto(BASE + "/login", wait_until="networkidle")
        pg.fill("input[type=email]", email)
        pg.fill("input[type=password]", PW)
        pg.get_by_role("button", name="Sign in").click()

    # --- login page is the real (non-demo) form
    pg.goto(BASE + "/login", wait_until="networkidle")
    check("login page shows password form (demo mode off)", pg.locator("input[type=password]").count() == 1)
    shot("01-login.png", 300)

    # --- customer
    login("customer@dataguard.demo")
    pg.wait_for_url("**/portal/**", timeout=30000)
    check("customer login -> portal", "/portal" in pg.url, pg.url)
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

    # --- DPO
    login("dpo@dataguard.demo")
    pg.wait_for_url(re.compile(r".*/admin$"), timeout=30000)
    pg.wait_for_selector("text=Pending alerts", timeout=30000) if pg.locator("text=Pending alerts").count() else pg.wait_for_timeout(3000)
    check("DPO login -> dashboard", pg.url.endswith("/admin"), pg.url)
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

    print("console errors:", len(errors), errors[:5])
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
