-- DataGuard AI - migration 002: cybersecurity features (ADDITIVE ONLY - no data is dropped).
-- Safe to run more than once (IF NOT EXISTS everywhere).
-- Adds: account lockout + MFA columns, server-side sessions, MFA backup codes,
-- sign-in attempt log, SAMPLE threat-intel list, security (rule) alerts,
-- incident-response playbook progress and NPC breach-notification fields.

ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count   INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until         TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_enc       TEXT;      -- AES-256-GCM, never returned by the API
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_pending_enc      TEXT;      -- secret during enrolment, before it is confirmed
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_step        BIGINT;    -- last accepted TOTP time-step (replay protection)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ;

-- Server-side sessions: the JWT in the httpOnly cookie carries the session id, so a
-- session can be listed and revoked ("sign out other devices").
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  ip            TEXT,          -- masked (last octet zeroed)
  user_agent    TEXT,
  mfa           BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mfa_backup_codes (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,     -- sha256, codes are shown to the user once
  used_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mfa_backup_user_idx ON mfa_backup_codes (user_id);

-- SAMPLE threat intelligence. Every row is synthetic and uses documentation-only
-- address ranges (RFC 5737). It is NOT a real blocklist.
CREATE TABLE IF NOT EXISTS threat_intel (
  id           SERIAL PRIMARY KEY,
  indicator    TEXT NOT NULL UNIQUE,        -- an IPv4 address or CIDR
  category     TEXT NOT NULL,               -- brute_force | credential_stuffing | botnet | tor_exit | scanner
  confidence   INT NOT NULL DEFAULT 70 CHECK (confidence BETWEEN 0 AND 100),
  source       TEXT NOT NULL DEFAULT 'SAMPLE synthetic feed (not real threat data)',
  description  TEXT,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every sign-in attempt (success or failure). Real client IPs are stored masked.
CREATE TABLE IF NOT EXISTS login_attempts (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  email        TEXT NOT NULL,
  user_id      INT REFERENCES users(id) ON DELETE SET NULL,
  ip           TEXT,
  user_agent   TEXT,
  device_hash  TEXT,
  success      BOOLEAN NOT NULL,
  reason       TEXT,                         -- bad_password | unknown_user | locked | mfa_failed | rate_limited | inactive | ok | mfa_ok
  country      TEXT,                         -- SYNTHETIC geo (no real geolocation is performed)
  city         TEXT,
  lat          REAL,
  lon          REAL,
  threat_match TEXT,                         -- threat_intel category if the IP is on the sample list
  synthetic    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS login_attempts_ts_idx    ON login_attempts (ts DESC);
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts (lower(email), ts DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx    ON login_attempts (ip, ts DESC);
CREATE INDEX IF NOT EXISTS login_attempts_user_idx  ON login_attempts (user_id, ts DESC);

-- Rule-based security alerts (brute force, impossible travel, new device, ...),
-- separate from the ML access-anomaly `alerts` table.
CREATE TABLE IF NOT EXISTS security_alerts (
  id            SERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  rule          TEXT NOT NULL,
  technique_id  TEXT,                        -- MITRE ATT&CK technique, e.g. T1110.001
  severity      TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title         TEXT NOT NULL,
  description   TEXT,
  user_id       INT REFERENCES users(id) ON DELETE SET NULL,
  email         TEXT,
  ip            TEXT,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'flagged_for_review'
                CHECK (status IN ('flagged_for_review', 'confirmed', 'false_positive')),
  reviewed_by   INT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  synthetic     BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS security_alerts_created_idx ON security_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS security_alerts_rule_idx    ON security_alerts (rule, email, ip, created_at DESC);

-- Incident-response playbook progress (contain / eradicate / recover / lessons learned).
CREATE TABLE IF NOT EXISTS incident_playbook_steps (
  incident_id   INT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  step_key      TEXT NOT NULL,
  completed_by  INT REFERENCES users(id) ON DELETE SET NULL,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (incident_id, step_key)
);

-- NPC Circular 16-03: notify the NPC within 72 hours of knowledge of a personal data breach.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS personal_data_breach  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS breach_discovered_at  TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS npc_notified_at       TIMESTAMPTZ;
