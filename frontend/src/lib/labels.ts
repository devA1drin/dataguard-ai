export const REASON_LABEL: Record<string, string> = {
  ok: "Signed in", mfa_ok: "Signed in with MFA", bad_password: "Wrong password", locked: "Account locked", mfa_failed: "Wrong MFA code",
  unknown_user: "Unknown account", inactive: "Account disabled", rate_limited: "IP rate-limited",
};
export const RULE_LABEL: Record<string, string> = {
  brute_force: "Brute force", password_spraying: "Password spraying", threat_intel_match: "Threat-intel match",
  impossible_travel: "Impossible travel", new_device: "New device", account_lockout: "Account lockout",
  website_scan_dangerous: "Dangerous website",
};
