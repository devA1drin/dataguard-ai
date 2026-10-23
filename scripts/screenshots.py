"""Capture full-page 1440px screenshots of the demo-mode frontend.
Usage: pip install playwright && playwright install chromium
       python scripts/screenshots.py http://localhost:3000 <alert_id> <incident_id> [out_dir]"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001"
OUT = (sys.argv[4] if len(sys.argv) > 4 else "screenshots") + "/"
ALERT_ID = sys.argv[2] if len(sys.argv) > 2 else "1"
INCIDENT_ID = sys.argv[3] if len(sys.argv) > 3 else "29"

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    pg = ctx.new_page()
    def shot(name, wait=900):
        pg.wait_for_timeout(wait)
        pg.screenshot(path=OUT + name, full_page=True)
        print("saved", OUT + name)
    pg.goto(BASE + "/login", wait_until="networkidle"); shot("01-login.png")
    # customer
    pg.get_by_text("Customer", exact=True).click(); pg.wait_for_url("**/portal/consents")
    shot("02-customer-consents.png", 1200)
    pg.goto(BASE + "/portal/requests", wait_until="networkidle"); shot("03-customer-data-rights-requests.png")
    pg.goto(BASE + "/portal/assistant", wait_until="networkidle")
    pg.get_by_role("button", name="How do I withdraw my consent for SMS promotions?").click()
    pg.wait_for_selector("text=Sources"); pg.wait_for_timeout(300)
    pg.fill("input[placeholder^='e.g.']", "What is the best pizza place in Makati?"); pg.get_by_role("button", name="Ask", exact=True).click()
    pg.wait_for_selector("text=Not covered by policy"); shot("04-customer-privacy-assistant.png")
    # DPO
    pg.goto(BASE + "/login", wait_until="networkidle")
    pg.get_by_text("Data Protection Officer", exact=True).click(); pg.wait_for_url("**/admin")
    shot("05-admin-dashboard.png", 1500)
    pg.goto(BASE + "/admin/alerts", wait_until="networkidle"); shot("06-admin-alerts-list.png")
    pg.goto(BASE + f"/admin/alerts/{ALERT_ID}", wait_until="networkidle"); shot("07-admin-alert-detail-shap.png", 1500)
    pg.goto(BASE + f"/admin/incidents/{INCIDENT_ID}", wait_until="networkidle"); shot("08-admin-incident-detail.png", 1200)
    pg.goto(BASE + "/admin/incidents", wait_until="networkidle"); shot("09-admin-incidents-list.png")
    pg.goto(BASE + "/admin/risk", wait_until="networkidle"); shot("10-admin-risk-analytics.png", 1500)
    pg.goto(BASE + "/admin/models", wait_until="networkidle"); shot("11-admin-model-performance.png", 1200)
    pg.goto(BASE + "/admin/audit", wait_until="networkidle")
    pg.get_by_role("button", name="Verify hash chain").click(); pg.wait_for_selector("text=Chain intact"); shot("12-admin-audit-log.png")
    # admin
    pg.goto(BASE + "/login", wait_until="networkidle")
    pg.get_by_text("System admin", exact=True).click(); pg.wait_for_url("**/admin")
    pg.goto(BASE + "/admin/users", wait_until="networkidle"); shot("13-admin-users-roles.png")
    b.close()
