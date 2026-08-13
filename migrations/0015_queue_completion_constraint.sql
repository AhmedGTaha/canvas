ALTER TABLE ai_follow_up_queue DROP CONSTRAINT ai_follow_up_queue_terminal_shape;
ALTER TABLE ai_follow_up_queue ADD CONSTRAINT ai_follow_up_queue_terminal_shape CHECK (
  (status IN ('claimed', 'completed')) = (generation_job_id IS NOT NULL AND claimed_at IS NOT NULL)
);
