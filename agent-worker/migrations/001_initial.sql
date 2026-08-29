CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_jobs (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  store_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','retry','completed','failed','cancelled')),
  payload jsonb NOT NULL,
  response jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, request_id),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS agent_jobs_claim_idx
  ON agent_jobs (status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE REFERENCES agent_jobs(id),
  organization_id text NOT NULL,
  store_id text NOT NULL,
  website text NOT NULL,
  rubric_hash text NOT NULL,
  model text NOT NULL,
  overall_score numeric(5,2),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  evidence_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_store_idx
  ON agent_runs (organization_id, store_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS agent_rule_results (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  store_id text NOT NULL,
  rule_id text NOT NULL,
  rule_text text NOT NULL,
  score numeric(5,2),
  explanation text NOT NULL,
  recommendation text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','confirmed','corrected','rejected','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, rule_id)
);

CREATE INDEX IF NOT EXISTS agent_rule_results_history_idx
  ON agent_rule_results (organization_id, store_id, rule_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_lessons (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  store_id text,
  rule_id text,
  content text NOT NULL,
  source text NOT NULL CHECK (source IN ('human','corrected_finding','import')),
  status text NOT NULL CHECK (status IN ('verified','superseded','revoked')),
  supersedes_id uuid REFERENCES agent_lessons(id),
  embedding vector(1536),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_lessons_scope_idx
  ON agent_lessons (organization_id, store_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS agent_lessons_embedding_idx
  ON agent_lessons USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS agent_feedback_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  run_id uuid NOT NULL REFERENCES agent_runs(id),
  rule_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('confirm','correct','reject')),
  payload jsonb NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_events (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  job_id uuid REFERENCES agent_jobs(id),
  event_type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enforce organization scoping in the application connection. If the database is
-- shared with user-facing SQL clients, add PostgreSQL RLS policies tied to a
-- verified organization claim before granting those clients access.
