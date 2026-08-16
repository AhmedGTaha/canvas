-- Workspace-owned AI connections (BYOK), the normalized model registry, project model
-- selection, and the durable usage records the AI analytics are computed from.
--
-- Credentials are stored only as authenticated-encryption ciphertext. No plaintext
-- credential column exists anywhere in the schema, and nothing here is readable without
-- the server-only Canvas master key.

CREATE TYPE ai_provider_kind AS ENUM ('gemini', 'openai', 'anthropic', 'openai_compatible');
CREATE TYPE ai_connection_test_status AS ENUM ('untested', 'passed', 'failed');
CREATE TYPE ai_model_source AS ENUM ('discovered', 'manual');
CREATE TYPE ai_request_kind AS ENUM ('generation', 'repair', 'test_console');
CREATE TYPE ai_cost_source AS ENUM ('provider_reported', 'canvas_estimate');

CREATE TABLE ai_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  provider ai_provider_kind NOT NULL,
  name varchar(80) NOT NULL,
  base_url varchar(500),
  credential_ciphertext text NOT NULL,
  credential_key_version integer NOT NULL DEFAULT 1,
  credential_hint varchar(24) NOT NULL,
  credential_updated_at timestamptz NOT NULL DEFAULT now(),
  last_tested_at timestamptz,
  last_test_status ai_connection_test_status NOT NULL DEFAULT 'untested',
  last_test_error varchar(300),
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT ai_connections_id_workspace_unique UNIQUE (id, workspace_id)
);
CREATE INDEX ai_connections_workspace_idx ON ai_connections (workspace_id, created_at);
-- One live connection name per workspace; removed connections keep their history rows.
CREATE UNIQUE INDEX ai_connections_workspace_name_unique ON ai_connections (workspace_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE ai_connection_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES ai_connections (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  model_id varchar(200) NOT NULL,
  display_name varchar(200) NOT NULL,
  source ai_model_source NOT NULL DEFAULT 'manual',
  enabled boolean NOT NULL DEFAULT false,
  supports_structured_output boolean NOT NULL DEFAULT true,
  supports_vision boolean NOT NULL DEFAULT false,
  context_window integer,
  max_output_tokens integer,
  -- Pricing is per one million tokens, in `pricing_currency`. NULL means unknown, which
  -- is never treated as free.
  input_price_per_million numeric(12, 6),
  output_price_per_million numeric(12, 6),
  pricing_currency char(3),
  pricing_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_connection_models_connection_model_unique UNIQUE (connection_id, model_id),
  CONSTRAINT ai_connection_models_id_connection_unique UNIQUE (id, connection_id)
);
CREATE INDEX ai_connection_models_connection_idx ON ai_connection_models (connection_id, enabled);

-- Project model selection. The row is deleted with the project; the connection and model
-- references are cleared rather than cascading, so removing a connection never destroys
-- project state — the next generation fails with a normalized configuration error.
CREATE TABLE project_ai_settings (
  project_id uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  connection_id uuid REFERENCES ai_connections (id) ON DELETE SET NULL,
  model_id uuid REFERENCES ai_connection_models (id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Durable, normalized record of every Canvas AI provider request. Never holds prompts,
-- generated source, or credentials.
CREATE TABLE ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE CASCADE,
  connection_id uuid REFERENCES ai_connections (id) ON DELETE SET NULL,
  generation_job_id uuid,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  provider ai_provider_kind NOT NULL,
  model_id varchar(200) NOT NULL,
  request_kind ai_request_kind NOT NULL,
  operation varchar(40) NOT NULL,
  prompt_version varchar(60),
  succeeded boolean NOT NULL,
  error_code varchar(80),
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  -- Provider round-trip only. Total job duration and validation time are separate.
  provider_latency_ms integer,
  job_duration_ms integer,
  validation_duration_ms integer,
  cost_source ai_cost_source,
  cost_amount numeric(14, 8),
  cost_currency char(3),
  -- Pricing snapshot the estimate was computed from, so historical cost never changes
  -- when a model's pricing metadata is edited later.
  pricing_input_per_million numeric(12, 6),
  pricing_output_per_million numeric(12, 6),
  pricing_version integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_events_project_created_idx ON ai_usage_events (project_id, created_at DESC);
CREATE INDEX ai_usage_events_workspace_created_idx ON ai_usage_events (workspace_id, created_at DESC);
CREATE INDEX ai_usage_events_job_idx ON ai_usage_events (generation_job_id);

-- Generation jobs record which connection and prompt revision produced them, plus the
-- stage timings analytics needs. `provider` stays the normalized provider name.
ALTER TABLE generation_jobs
  ADD COLUMN ai_connection_id uuid REFERENCES ai_connections (id) ON DELETE SET NULL,
  ADD COLUMN prompt_version varchar(60),
  ADD COLUMN provider_latency_ms integer,
  ADD COLUMN validation_duration_ms integer,
  ADD COLUMN repair_attempt_count integer NOT NULL DEFAULT 0;

-- The provider column predates workspace connections and was NOT NULL with no default,
-- which required job creation to know the provider before resolution. Resolution now
-- happens in the worker, so the column is filled at creation when a project already has a
-- selection and defaults to a neutral placeholder otherwise.
ALTER TABLE generation_jobs ALTER COLUMN provider SET DEFAULT 'unresolved';
