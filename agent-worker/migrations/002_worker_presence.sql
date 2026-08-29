CREATE TABLE IF NOT EXISTS agent_workers (
  worker_id text PRIMARY KEY,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('online','stopping','offline')),
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_workers_presence_idx
  ON agent_workers (status, last_seen_at DESC);
