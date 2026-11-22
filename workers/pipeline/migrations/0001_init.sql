-- 0001: app key-value store used by lib/store.js d1Backend (atomic incrby/setnx via SQL), plus the job tables.
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, x INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS kv_x ON kv (x) WHERE x > 0;
-- D1 schema mirroring the job record in lib/ops/jobs.js. Every row carries the workspace id: all queries MUST filter by ws.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, ws TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('queued','processing','validating','completed','failed','cancelled')),
  workflow TEXT NOT NULL, idempotency_key TEXT NOT NULL, model TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  input_refs TEXT NOT NULL, output_ref TEXT, error TEXT, cost_estimate_usd REAL, cost_actual_usd REAL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (ws, idempotency_key)
);
CREATE INDEX IF NOT EXISTS jobs_ws_state ON jobs (ws, state, created_at DESC);
CREATE TABLE IF NOT EXISTS job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, ws TEXT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS masters (id TEXT PRIMARY KEY, ws TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, ws TEXT NOT NULL, status TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS executions (approval_id TEXT PRIMARY KEY, ws TEXT NOT NULL, state TEXT NOT NULL, record TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usage_counters (ws TEXT NOT NULL, kind TEXT NOT NULL, span TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ws, kind, span));
