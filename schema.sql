-- Isolated pilot database only. NEVER run against the production mailing DB.
-- All example businesses, contacts and observations below are synthetic.
CREATE TABLE IF NOT EXISTS m1_leads (
  id TEXT PRIMARY KEY,
  is_synthetic INTEGER NOT NULL CHECK (is_synthetic = 1),
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS m1_budget (
  utc_day TEXT PRIMARY KEY,
  model_calls INTEGER NOT NULL DEFAULT 0 CHECK (model_calls BETWEEN 0 AND 1)
);

CREATE TABLE IF NOT EXISTS m1_runs (
  id TEXT PRIMARY KEY,
  utc_day TEXT NOT NULL,
  lead_id TEXT NOT NULL REFERENCES m1_leads(id),
  status TEXT NOT NULL CHECK (status IN ('running', 'draft_needs_review', 'held')),
  reason TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  draft_json TEXT,
  sending_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sending_enabled = 0)
);

CREATE TABLE IF NOT EXISTS m1_ticks (
  id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  run_id TEXT,
  outcome TEXT NOT NULL
);

INSERT OR IGNORE INTO m1_leads (id, is_synthetic, payload) VALUES (
  'synthetic-clinic-001',
  1,
  '{"id":"synthetic-clinic-001","isSynthetic":true,"businessName":"Harbor Example Clinic","category":"clinic","country":"US","contactEmail":"office@harbor-clinic.example","evidence":[{"id":"fixture-booking-gap","sourceUrl":"https://harbor-clinic.example/contact","kind":"synthetic_fixture","fact":"The synthetic contact page asks patients to call for appointment requests and has no appointment-request form."}]}'
);
