CREATE TYPE ai_message_role AS ENUM ('user', 'assistant', 'system_internal');
CREATE TYPE generation_target_type AS ENUM ('project', 'page', 'building_block');
CREATE TYPE generation_job_status AS ENUM ('queued', 'preparing_context', 'generating', 'validating', 'applying', 'completed', 'failed', 'cancelled');

CREATE TABLE project_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content text NOT NULL,
  revision_number integer NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_instructions_project_revision_unique UNIQUE (project_id, revision_number),
  CONSTRAINT project_instructions_content_limit CHECK (length(content) <= 12000),
  CONSTRAINT project_instructions_id_project_unique UNIQUE (id, project_id)
);

ALTER TABLE projects ADD COLUMN current_instruction_id uuid;
ALTER TABLE projects ADD CONSTRAINT projects_current_instruction_project_fk
  FOREIGN KEY (current_instruction_id, id) REFERENCES project_instructions(id, project_id) ON DELETE RESTRICT;

CREATE INDEX project_instructions_project_created_idx ON project_instructions(project_id, created_at DESC);

CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_id uuid,
  building_block_id uuid,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT ai_conversations_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT ai_conversations_page_project_fk FOREIGN KEY (page_id, project_id) REFERENCES page_nodes(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT ai_conversations_building_block_reserved CHECK (building_block_id IS NULL)
);

CREATE INDEX ai_conversations_project_updated_idx ON ai_conversations(project_id, updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX ai_conversations_page_idx ON ai_conversations(project_id, page_id) WHERE archived_at IS NULL;

CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role ai_message_role NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  content text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_messages_id_conversation_unique UNIQUE (id, conversation_id),
  CONSTRAINT ai_messages_content_not_blank CHECK (length(trim(content)) > 0),
  CONSTRAINT ai_messages_content_limit CHECK (length(content) <= 10000),
  CONSTRAINT ai_messages_user_role_actor CHECK ((role = 'user' AND user_id IS NOT NULL) OR (role <> 'user' AND user_id IS NULL))
);

CREATE INDEX ai_messages_conversation_created_idx ON ai_messages(conversation_id, created_at DESC);

CREATE TABLE generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id uuid,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_type generation_target_type NOT NULL,
  target_id uuid,
  prompt_message_id uuid,
  status generation_job_status NOT NULL DEFAULT 'queued',
  progress_stage varchar(80) NOT NULL DEFAULT 'Queued',
  provider varchar(40) NOT NULL,
  provider_model varchar(120),
  provider_request_id varchar(255),
  error_code varchar(80),
  error_message varchar(500),
  result_message_id uuid UNIQUE,
  result_change_set_id uuid,
  usage_metadata jsonb,
  context_fingerprint char(64),
  context_metadata jsonb,
  cancel_requested_at timestamptz,
  claimed_at timestamptz,
  worker_id varchar(120),
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT generation_jobs_conversation_project_fk FOREIGN KEY (conversation_id, project_id) REFERENCES ai_conversations(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT generation_jobs_prompt_conversation_fk FOREIGN KEY (prompt_message_id, conversation_id) REFERENCES ai_messages(id, conversation_id) ON DELETE RESTRICT,
  CONSTRAINT generation_jobs_result_conversation_fk FOREIGN KEY (result_message_id, conversation_id) REFERENCES ai_messages(id, conversation_id) ON DELETE RESTRICT,
  CONSTRAINT generation_jobs_attempt_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT generation_jobs_target_shape CHECK ((target_type = 'project' AND target_id IS NULL) OR (target_type <> 'project' AND target_id IS NOT NULL)),
  CONSTRAINT generation_jobs_building_block_reserved CHECK (target_type <> 'building_block'),
  CONSTRAINT generation_jobs_terminal_timestamp CHECK ((status IN ('completed', 'failed', 'cancelled')) = (finished_at IS NOT NULL))
);

CREATE INDEX generation_jobs_project_created_idx ON generation_jobs(project_id, created_at DESC);
CREATE INDEX generation_jobs_claim_idx ON generation_jobs(status, available_at, created_at) WHERE status = 'queued';
CREATE INDEX generation_jobs_active_target_idx ON generation_jobs(project_id, target_type, target_id) WHERE status IN ('queued', 'preparing_context', 'generating', 'validating', 'applying');

CREATE TABLE ai_job_rate_limits (
  scope varchar(16) NOT NULL,
  subject_id uuid NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject_id),
  CONSTRAINT ai_job_rate_limits_scope_check CHECK (scope IN ('user', 'project'))
);
