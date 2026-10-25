-- DataGuard AI - migration 005: Website Scanner (ADDITIVE ONLY - no data is dropped).
-- Safe to run more than once (IF NOT EXISTS everywhere).
-- One row per scan of a REAL, live website requested by a signed-in user.
-- Customers can read only their own rows (enforced in backend/src/routes/scanner.ts); staff can read all.

CREATE TABLE IF NOT EXISTS website_scans (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  url         TEXT NOT NULL,                       -- what the user asked to scan (normalised)
  final_url   TEXT,                                -- where the redirects ended (NULL if the site could not be loaded)
  score       SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  verdict     TEXT NOT NULL CHECK (verdict IN ('Safe', 'Suspicious', 'Dangerous')),
  findings    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{id, category, severity, title, explanation, evidence, positive}]
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- redirect chain, TLS, headers, domain age, ML probability, page facts
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS website_scans_user_idx    ON website_scans (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS website_scans_created_idx ON website_scans (created_at DESC);
