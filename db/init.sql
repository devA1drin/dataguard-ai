-- DataGuard AI - PostgreSQL schema
-- All data loaded into this schema by seed.sql is SYNTHETIC.


CREATE TYPE app_role AS ENUM ('customer', 'dpo', 'security', 'admin', 'executive');

CREATE TABLE customers (
  id          SERIAL PRIMARY KEY,
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  phone       TEXT,
  city        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,              -- bcrypt
  full_name      TEXT NOT NULL,
  role           app_role NOT NULL,
  customer_id    INT REFERENCES customers(id),  -- set only for role = customer
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

CREATE TABLE consents (
  id           SERIAL PRIMARY KEY,
  customer_id  INT NOT NULL REFERENCES customers(id),
  purpose      TEXT NOT NULL,
  granted      BOOLEAN NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, purpose)
);

CREATE TABLE consent_history (
  id           SERIAL PRIMARY KEY,
  customer_id  INT NOT NULL REFERENCES customers(id),
  purpose      TEXT NOT NULL,
  granted      BOOLEAN NOT NULL,
  channel      TEXT NOT NULL DEFAULT 'portal',
  changed_by   INT REFERENCES users(id),
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE data_requests (
  id           SERIAL PRIMARY KEY,
  reference    TEXT NOT NULL UNIQUE,
  customer_id  INT NOT NULL REFERENCES customers(id),
  type         TEXT NOT NULL CHECK (type IN ('access', 'correction', 'deletion')),
  details      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'in_review', 'completed', 'rejected')),
  response     TEXT,
  handled_by   INT REFERENCES users(id),     -- internal, never exposed to customers
  internal_note TEXT,                        -- internal, never exposed to customers
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at       TIMESTAMPTZ NOT NULL DEFAULT now() + interval '21 days'
);

CREATE TABLE access_logs (
  id                  BIGSERIAL PRIMARY KEY,
  ts                  TIMESTAMPTZ NOT NULL,
  employee_id         TEXT NOT NULL,
  employee_role       TEXT NOT NULL,
  resource            TEXT NOT NULL,
  customer_id         INT REFERENCES customers(id),
  hour_of_day         SMALLINT NOT NULL,
  records_accessed    INT NOT NULL,
  distinct_customers  INT NOT NULL,
  off_hours           SMALLINT NOT NULL,
  is_weekend          SMALLINT NOT NULL DEFAULT 0,
  export_flag         SMALLINT NOT NULL DEFAULT 0,
  failed_logins       SMALLINT NOT NULL DEFAULT 0,
  risk_score          REAL,          -- filled by the scoring job (ML service)
  anomaly_score       REAL,
  scored_at           TIMESTAMPTZ,
  synthetic_label     BOOLEAN,       -- ground truth from the generator, for evaluation only
  synthetic_type      TEXT
);
CREATE INDEX access_logs_unscored ON access_logs (id) WHERE scored_at IS NULL;
CREATE INDEX access_logs_ts ON access_logs (ts);

CREATE TABLE alerts (
  id             SERIAL PRIMARY KEY,
  access_log_id  BIGINT NOT NULL UNIQUE REFERENCES access_logs(id),
  risk_score     REAL NOT NULL,
  status         TEXT NOT NULL DEFAULT 'flagged_for_review'
                 CHECK (status IN ('flagged_for_review', 'confirmed', 'false_positive')),
  explanation    JSONB,           -- SHAP contributions from /anomaly/explain
  reviewed_by    INT REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  review_note    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE incidents (
  id                   SERIAL PRIMARY KEY,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,
  severity             TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status               TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'investigating', 'contained', 'resolved', 'closed')),
  reported_by          INT REFERENCES users(id),
  assigned_to          INT REFERENCES users(id),
  predicted_category   TEXT,      -- ML suggestion
  category_confidence  REAL,
  final_category       TEXT,      -- confirmed by a human
  related_alert_id     INT REFERENCES alerts(id),
  reported_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE incident_actions (
  id           SERIAL PRIMARY KEY,
  incident_id  INT NOT NULL REFERENCES incidents(id),
  action_type  TEXT NOT NULL CHECK (action_type IN ('note', 'corrective_action', 'status_change', 'assignment')),
  content      TEXT NOT NULL,
  completed    BOOLEAN NOT NULL DEFAULT false,
  actor_id     INT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only, hash-chained audit trail.
-- hash = sha256(prev_hash || canonical_json(row content)), computed by the backend.
CREATE TABLE audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL,
  actor_id     INT,
  actor_role   TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  details      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip           TEXT,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE
);

-- Enforce append-only at the database level (defence in depth; a DB superuser can still
-- bypass this, which is exactly what the hash chain is meant to make detectable).
CREATE OR REPLACE FUNCTION audit_logs_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_change();

CREATE TABLE model_predictions (
  id           BIGSERIAL PRIMARY KEY,
  model_name   TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  input        JSONB,
  output       JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
