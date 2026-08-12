CREATE TYPE change_set_operation AS ENUM (
  'page_generate', 'page_modify', 'block_generate', 'block_modify',
  'block_duplicate', 'block_global_toggle', 'block_archive',
  'page_version_restore', 'block_version_restore', 'checkpoint_restore',
  'undo', 'redo'
);
CREATE TYPE change_set_entity_type AS ENUM ('page', 'building_block', 'project');

-- One reversible Canvas operation. Items reference immutable versions rather than
-- copying source, so history never duplicates generated code.
CREATE TABLE change_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation change_set_operation NOT NULL,
  summary varchar(300) NOT NULL,
  reversible boolean NOT NULL DEFAULT true,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  generation_job_id uuid,
  source_change_set_id uuid,
  undone_at timestamptz,
  undone_by_change_set_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT change_sets_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT change_sets_sequence_unique UNIQUE (sequence),
  CONSTRAINT change_sets_summary_not_blank CHECK (btrim(summary) <> ''),
  CONSTRAINT change_sets_job_project_fk FOREIGN KEY (generation_job_id, project_id) REFERENCES generation_jobs(id, project_id) ON DELETE SET NULL,
  CONSTRAINT change_sets_source_project_fk FOREIGN KEY (source_change_set_id, project_id) REFERENCES change_sets(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT change_sets_undone_by_project_fk FOREIGN KEY (undone_by_change_set_id, project_id) REFERENCES change_sets(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT change_sets_undone_shape CHECK ((undone_at IS NULL) = (undone_by_change_set_id IS NULL)),
  CONSTRAINT change_sets_history_not_reversible CHECK (operation NOT IN ('undo', 'redo') OR reversible = false)
);

CREATE TABLE change_set_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_set_id uuid NOT NULL,
  project_id uuid NOT NULL,
  entity_type change_set_entity_type NOT NULL,
  entity_id uuid,
  before_version_id uuid,
  after_version_id uuid,
  before_state jsonb,
  after_state jsonb,
  position integer NOT NULL,
  CONSTRAINT change_set_items_set_project_fk FOREIGN KEY (change_set_id, project_id) REFERENCES change_sets(id, project_id) ON DELETE CASCADE,
  CONSTRAINT change_set_items_set_position_unique UNIQUE (change_set_id, position),
  CONSTRAINT change_set_items_position_nonnegative CHECK (position >= 0),
  CONSTRAINT change_set_items_entity_shape CHECK ((entity_type = 'project') = (entity_id IS NULL))
);

CREATE INDEX change_sets_project_sequence_idx ON change_sets(project_id, sequence DESC);
CREATE INDEX change_sets_project_undone_idx ON change_sets(project_id, undone_at DESC) WHERE undone_at IS NOT NULL;
CREATE INDEX change_set_items_entity_idx ON change_set_items(project_id, entity_type, entity_id);

ALTER TABLE page_versions ADD COLUMN change_set_id uuid;
ALTER TABLE page_versions ADD CONSTRAINT page_versions_change_set_project_fk
  FOREIGN KEY (change_set_id, project_id) REFERENCES change_sets(id, project_id) ON DELETE SET NULL;
ALTER TABLE building_block_versions ADD CONSTRAINT building_block_versions_change_set_project_fk
  FOREIGN KEY (change_set_id, project_id) REFERENCES change_sets(id, project_id) ON DELETE SET NULL;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_result_change_set_project_fk
  FOREIGN KEY (result_change_set_id, project_id) REFERENCES change_sets(id, project_id) ON DELETE SET NULL;

-- Immutable named snapshot of the project's active state.
CREATE TABLE project_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  project_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_checkpoints_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT project_checkpoints_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT project_checkpoints_state_object CHECK (jsonb_typeof(project_state) = 'object')
);

CREATE TABLE project_checkpoint_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id uuid NOT NULL,
  project_id uuid NOT NULL,
  entity_type change_set_entity_type NOT NULL,
  entity_id uuid,
  version_id uuid,
  entity_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  position integer NOT NULL,
  CONSTRAINT project_checkpoint_items_checkpoint_project_fk FOREIGN KEY (checkpoint_id, project_id) REFERENCES project_checkpoints(id, project_id) ON DELETE CASCADE,
  CONSTRAINT project_checkpoint_items_position_unique UNIQUE (checkpoint_id, position),
  CONSTRAINT project_checkpoint_items_entity_unique UNIQUE (checkpoint_id, entity_type, entity_id),
  CONSTRAINT project_checkpoint_items_position_nonnegative CHECK (position >= 0),
  CONSTRAINT project_checkpoint_items_entity_shape CHECK ((entity_type = 'project') = (entity_id IS NULL))
);

CREATE INDEX project_checkpoints_project_created_idx ON project_checkpoints(project_id, created_at DESC);
CREATE INDEX project_checkpoint_items_checkpoint_idx ON project_checkpoint_items(checkpoint_id, position);

CREATE FUNCTION prevent_project_checkpoint_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project_checkpoints are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER project_checkpoints_immutable
  BEFORE UPDATE ON project_checkpoints
  FOR EACH ROW EXECUTE FUNCTION prevent_project_checkpoint_update();

CREATE TRIGGER project_checkpoint_items_immutable
  BEFORE UPDATE ON project_checkpoint_items
  FOR EACH ROW EXECUTE FUNCTION prevent_project_checkpoint_update();

CREATE FUNCTION prevent_change_set_item_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'change_set_items are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER change_set_items_immutable
  BEFORE UPDATE ON change_set_items
  FOR EACH ROW EXECUTE FUNCTION prevent_change_set_item_update();
