import { test } from "node:test";
import assert from "node:assert/strict";
import { BlockedError, checkUrlShape, isBlockedIp, resolvePublic, safeFetch, type Resolver } from "./ssrf";
import { normalizeInput } from "./scan";

test("private, loopback, link-local and metadata IPv4 addresses are blocked", () => {
  for (const ip of ["127.0.0.1", "127.255.255.254", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "198.18.0.1", "224.0.0.1", "255.255.255.255", "192.0.2.10"]) assert.equal(isBlockedIp(ip), true, ip);
});

test("IPv6 loopback, ULA, link-local, mapped and NAT64 forms are blocked", () => {
  for (const ip of ["::1", "::", "fe80::1", "fd00:ec2::254", "fc00::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1",
    "64:ff9b::a9fe:a9fe", "ff02::1", "2001:db8::1"]) assert.equal(isBlockedIp(ip), true, ip);
});

test("public addresses are allowed", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "142.250.72.4", "172.32.0.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::2004"]) assert.equal(isBlockedIp(ip), false, ip);
});

test("anything that is not an IP is treated as blocked", () => {
  assert.equal(isBlockedIp("localhost"), true);
  assert.equal(isBlockedIp(""), true);
});

test("only http/https and web ports are accepted", () => {
  for (const u of ["ftp://example.com/", "file:///etc/passwd", "gopher://example.com/", "javascript:alert(1)", "data:text/html,hi", "http://example.com:22/", "http://example.com:6379/"])
    assert.throws(() => checkUrlShape(u), BlockedError, u);
  assert.equal(checkUrlShape("https://example.com/").hostname, "example.com");
  assert.equal(checkUrlShape("http://example.com:8080/").port, "8080");
});

const fake = (map: Record<string, string[]>): Resolver => async (h) => (map[h] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

test("literal and encoded private IPs are blocked without any DNS lookup", async () => {
  const never: Resolver = async () => { throw new Error("must not resolve"); };
  for (const u of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://2130706433/", "http://0x7f.1/", "http://017700000001/"])
    await assert.rejects(resolvePublic(new URL(u).hostname, never), BlockedError, u);
});

test("local host names are blocked", async () => {
  for (const h of ["localhost", "foo.localhost", "printer.local", "metadata.google.internal", "intranet"])
    await assert.rejects(resolvePublic(h, fake({ [h]: ["93.184.216.34"] })), BlockedError, h);
});

test("a name that resolves to a private IP is blocked (also when only ONE of its addresses is private)", async () => {
  await assert.rejects(resolvePublic("evil.example", fake({ "evil.example": ["10.1.2.3"] })), BlockedError);
  await assert.rejects(resolvePublic("mixed.example", fake({ "mixed.example": ["93.184.216.34", "169.254.169.254"] })), BlockedError);
  const ok = await resolvePublic("good.example", fake({ "good.example": ["93.184.216.34"] }));
  assert.equal(ok.address, "93.184.216.34");
});

test("safeFetch refuses before connecting when the target is internal", async () => {
  await assert.rejects(safeFetch("http://rebind.example/", fake({ "rebind.example": ["127.0.0.1"] })), BlockedError);
  await assert.rejects(safeFetch("http://169.254.169.254/"), BlockedError);
});

test("input normalisation adds https:// but keeps explicit schemes", () => {
  assert.equal(normalizeInput("example.com"), "https://example.com");
  assert.equal(normalizeInput("  http://neverssl.com "), "http://neverssl.com");
  assert.equal(normalizeInput("localhost:3000").startsWith("https://localhost:3000"), true);
});

// Optional live check: a public redirector that bounces to the cloud metadata IP must be stopped at hop 2.
test("redirects into private space are blocked on every hop (live)", { skip: process.env.SCANNER_LIVE_TESTS !== "1" }, async () => {
  await assert.rejects(safeFetch("https://httpbin.org/redirect-to?url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F"),
    (e: Error) => e instanceof BlockedError && /hop/i.test(e.message));
});
