CREATE TYPE ai_queue_status AS ENUM ('queued', 'paused', 'claimed', 'cancelled');
CREATE TABLE ai_follow_up_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_type lease_target_type NOT NULL, target_id uuid NOT NULL, creator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 12000), selected_media_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_element jsonb, base_version_id uuid, status ai_queue_status NOT NULL DEFAULT 'queued', pause_reason varchar(500),
  sequence bigint GENERATED ALWAYS AS IDENTITY, generation_job_id uuid REFERENCES generation_jobs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz, cancelled_at timestamptz,
  CONSTRAINT ai_follow_up_queue_job_unique UNIQUE (generation_job_id),
  CONSTRAINT ai_follow_up_queue_media_array CHECK (jsonb_typeof(selected_media_ids) = 'array'),
  CONSTRAINT ai_follow_up_queue_terminal_shape CHECK ((status = 'claimed') = (generation_job_id IS NOT NULL AND claimed_at IS NOT NULL))
);
CREATE INDEX ai_follow_up_queue_claim_idx ON ai_follow_up_queue(status, sequence) WHERE status = 'queued';
CREATE INDEX ai_follow_up_queue_project_target_idx ON ai_follow_up_queue(project_id, target_type, target_id, sequence);
CREATE INDEX ai_follow_up_queue_user_idx ON ai_follow_up_queue(creator_user_id, status);
ALTER TABLE generation_jobs ADD COLUMN queue_item_id uuid REFERENCES ai_follow_up_queue(id) ON DELETE SET NULL;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_queue_item_unique UNIQUE (queue_item_id);
