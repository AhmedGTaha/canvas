CREATE TYPE export_job_status AS ENUM ('queued', 'validating', 'assembling', 'building', 'packaging', 'completed', 'failed');

CREATE TABLE export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status export_job_status NOT NULL DEFAULT 'queued',
  progress_stage varchar(80) NOT NULL DEFAULT 'Queued',
  validation jsonb,
  error_code varchar(80),
  error_message varchar(500),
  artifact_storage_key text,
  artifact_file_name varchar(160),
  artifact_bytes bigint,
  artifact_file_count integer,
  claimed_at timestamptz,
  worker_id varchar(120),
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT export_jobs_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT export_jobs_artifact_key_unique UNIQUE (artifact_storage_key),
  CONSTRAINT export_jobs_attempt_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT export_jobs_terminal_timestamp CHECK ((status IN ('completed', 'failed')) = (finished_at IS NOT NULL)),
  -- A downloadable artifact exists only for a completed export.
  CONSTRAINT export_jobs_completed_artifact CHECK (status <> 'completed' OR (artifact_storage_key IS NOT NULL AND artifact_bytes IS NOT NULL)),
  CONSTRAINT export_jobs_artifact_requires_completion CHECK (artifact_storage_key IS NULL OR status = 'completed'),
  CONSTRAINT export_jobs_artifact_bytes_positive CHECK (artifact_bytes IS NULL OR artifact_bytes > 0)
);

-- One export at a time per project; Canvas stays usable while it runs.
CREATE UNIQUE INDEX export_jobs_one_active
  ON export_jobs(project_id)
  WHERE status IN ('queued', 'validating', 'assembling', 'building', 'packaging');

CREATE INDEX export_jobs_project_created_idx ON export_jobs(project_id, created_at DESC);
CREATE INDEX export_jobs_claim_idx ON export_jobs(status, available_at, created_at) WHERE status = 'queued';
