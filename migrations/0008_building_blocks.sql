CREATE TABLE building_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  kind varchar(40) NOT NULL DEFAULT 'custom',
  is_global boolean NOT NULL DEFAULT false,
  current_version_id uuid,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT building_blocks_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT building_blocks_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT building_blocks_kind_format CHECK (kind ~ '^[a-z][a-z0-9_]{0,39}$')
);

CREATE TABLE building_block_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  building_block_id uuid NOT NULL,
  version_number integer NOT NULL,
  source_code text NOT NULL,
  manifest jsonb NOT NULL,
  change_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_hash char(64) NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  generation_job_id uuid,
  change_set_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT building_block_versions_block_project_fk FOREIGN KEY (building_block_id, project_id) REFERENCES building_blocks(id, project_id) ON DELETE CASCADE,
  CONSTRAINT building_block_versions_block_number_unique UNIQUE (building_block_id, version_number),
  CONSTRAINT building_block_versions_generation_job_unique UNIQUE (generation_job_id),
  CONSTRAINT building_block_versions_id_block_project_unique UNIQUE (id, building_block_id, project_id),
  CONSTRAINT building_block_versions_version_positive CHECK (version_number > 0),
  CONSTRAINT building_block_versions_source_size CHECK (octet_length(source_code) <= 102400),
  CONSTRAINT building_block_versions_source_hash_format CHECK (source_hash ~ '^[0-9a-f]{64}$')
);

ALTER TABLE building_blocks ADD CONSTRAINT building_blocks_current_version_fk
  FOREIGN KEY (current_version_id, id, project_id) REFERENCES building_block_versions(id, building_block_id, project_id) ON DELETE RESTRICT;

-- Active page state only. A usage pinned to a version resolves that version; a null
-- version pointer means the usage resolves the block's current active version (global).
CREATE TABLE building_block_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_id uuid NOT NULL,
  building_block_id uuid NOT NULL,
  building_block_version_id uuid,
  usage_key varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT building_block_usages_page_project_fk FOREIGN KEY (page_id, project_id) REFERENCES page_nodes(id, project_id) ON DELETE CASCADE,
  CONSTRAINT building_block_usages_block_project_fk FOREIGN KEY (building_block_id, project_id) REFERENCES building_blocks(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT building_block_usages_version_block_fk FOREIGN KEY (building_block_version_id, building_block_id, project_id) REFERENCES building_block_versions(id, building_block_id, project_id) ON DELETE RESTRICT,
  CONSTRAINT building_block_usages_page_key_unique UNIQUE (page_id, usage_key),
  CONSTRAINT building_block_usages_key_format CHECK (usage_key ~ '^[a-z0-9][a-z0-9-]{0,63}$')
);

CREATE INDEX building_blocks_project_updated_idx ON building_blocks(project_id, updated_at DESC);
CREATE INDEX building_block_versions_block_created_idx ON building_block_versions(project_id, building_block_id, created_at DESC);
CREATE INDEX building_block_usages_block_idx ON building_block_usages(project_id, building_block_id);
CREATE INDEX building_block_usages_page_idx ON building_block_usages(page_id);

CREATE FUNCTION prevent_building_block_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'building_block_versions are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER building_block_versions_immutable
  BEFORE UPDATE ON building_block_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_building_block_version_update();

-- Block-scoped AI conversations and generation targets are now live: the Phase 6
-- placeholders that reserved them are replaced with real referential integrity.
ALTER TABLE ai_conversations DROP CONSTRAINT ai_conversations_building_block_reserved;
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_building_block_reserved;
ALTER TABLE ai_conversations ADD CONSTRAINT ai_conversations_block_project_fk
  FOREIGN KEY (building_block_id, project_id) REFERENCES building_blocks(id, project_id) ON DELETE CASCADE;
ALTER TABLE ai_conversations ADD CONSTRAINT ai_conversations_single_target_check
  CHECK (page_id IS NULL OR building_block_id IS NULL);
CREATE INDEX ai_conversations_block_idx ON ai_conversations(project_id, building_block_id);

-- Extend the shared generation vocabulary with block operations. The enum is replaced
-- rather than extended so the new labels are usable inside this same transaction.
DROP INDEX generation_jobs_one_active_page_mutation;
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_operation_target_check;
ALTER TABLE generation_jobs ALTER COLUMN operation DROP DEFAULT;
ALTER TYPE generation_operation RENAME TO generation_operation_legacy;
CREATE TYPE generation_operation AS ENUM ('assistant', 'page_generate', 'page_modify', 'block_generate', 'block_modify');
ALTER TABLE generation_jobs ALTER COLUMN operation TYPE generation_operation USING operation::text::generation_operation;
ALTER TABLE generation_jobs ALTER COLUMN operation SET DEFAULT 'assistant';
DROP TYPE generation_operation_legacy;

ALTER TABLE generation_jobs ADD COLUMN base_block_version_id uuid;
ALTER TABLE generation_jobs ADD COLUMN result_block_version_id uuid;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_base_block_version_fk
  FOREIGN KEY (base_block_version_id, target_id, project_id) REFERENCES building_block_versions(id, building_block_id, project_id) ON DELETE RESTRICT;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_result_block_version_fk
  FOREIGN KEY (result_block_version_id, target_id, project_id) REFERENCES building_block_versions(id, building_block_id, project_id) ON DELETE RESTRICT;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_operation_target_check CHECK (
  (operation = 'assistant')
  OR (operation IN ('page_generate', 'page_modify') AND target_type = 'page' AND target_id IS NOT NULL)
  OR (operation IN ('block_generate', 'block_modify') AND target_type = 'building_block' AND target_id IS NOT NULL)
);

ALTER TABLE building_block_versions ADD CONSTRAINT building_block_versions_generation_job_fk
  FOREIGN KEY (generation_job_id) REFERENCES generation_jobs(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX generation_jobs_one_active_page_mutation
  ON generation_jobs(project_id, target_id)
  WHERE operation IN ('page_generate', 'page_modify') AND status IN ('queued', 'preparing_context', 'generating', 'validating', 'applying');

CREATE UNIQUE INDEX generation_jobs_one_active_block_mutation
  ON generation_jobs(project_id, target_id)
  WHERE operation IN ('block_generate', 'block_modify') AND status IN ('queued', 'preparing_context', 'generating', 'validating', 'applying');
