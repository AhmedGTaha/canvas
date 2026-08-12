CREATE TYPE generation_operation AS ENUM ('assistant', 'page_generate', 'page_modify');

CREATE TABLE page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_id uuid NOT NULL,
  version_number integer NOT NULL,
  source_code text NOT NULL,
  manifest jsonb NOT NULL,
  seo_metadata jsonb NOT NULL,
  change_summary jsonb NOT NULL,
  source_hash char(64) NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  generation_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT page_versions_page_project_fk FOREIGN KEY (page_id, project_id) REFERENCES page_nodes(id, project_id) ON DELETE CASCADE,
  CONSTRAINT page_versions_page_number_unique UNIQUE (page_id, version_number),
  CONSTRAINT page_versions_generation_job_unique UNIQUE (generation_job_id),
  CONSTRAINT page_versions_id_page_project_unique UNIQUE (id, page_id, project_id),
  CONSTRAINT page_versions_version_positive CHECK (version_number > 0),
  CONSTRAINT page_versions_source_size CHECK (octet_length(source_code) <= 102400),
  CONSTRAINT page_versions_source_hash_format CHECK (source_hash ~ '^[0-9a-f]{64}$')
);

ALTER TABLE page_nodes ADD COLUMN current_version_id uuid;
ALTER TABLE page_nodes ADD CONSTRAINT page_nodes_current_version_fk
  FOREIGN KEY (current_version_id, id, project_id) REFERENCES page_versions(id, page_id, project_id) ON DELETE RESTRICT;

ALTER TABLE generation_jobs ADD COLUMN operation generation_operation NOT NULL DEFAULT 'assistant';
ALTER TABLE generation_jobs ADD COLUMN base_page_version_id uuid;
ALTER TABLE generation_jobs ADD COLUMN result_page_version_id uuid;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_id_project_unique UNIQUE (id, project_id);
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_base_page_version_fk
  FOREIGN KEY (base_page_version_id, target_id, project_id) REFERENCES page_versions(id, page_id, project_id) ON DELETE RESTRICT;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_result_page_version_fk
  FOREIGN KEY (result_page_version_id, target_id, project_id) REFERENCES page_versions(id, page_id, project_id) ON DELETE RESTRICT;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_operation_target_check CHECK (
  (operation = 'assistant') OR (operation IN ('page_generate', 'page_modify') AND target_type = 'page' AND target_id IS NOT NULL)
);

ALTER TABLE page_versions ADD CONSTRAINT page_versions_generation_job_fk
  FOREIGN KEY (generation_job_id) REFERENCES generation_jobs(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX generation_jobs_one_active_page_mutation
  ON generation_jobs(project_id, target_id)
  WHERE operation IN ('page_generate', 'page_modify') AND status IN ('queued', 'preparing_context', 'generating', 'validating', 'applying');

CREATE TABLE generation_job_media (
  generation_job_id uuid NOT NULL,
  project_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (generation_job_id, media_asset_id),
  CONSTRAINT generation_job_media_job_project_fk FOREIGN KEY (generation_job_id, project_id) REFERENCES generation_jobs(id, project_id) ON DELETE CASCADE,
  CONSTRAINT generation_job_media_asset_project_fk FOREIGN KEY (media_asset_id, project_id) REFERENCES media_assets(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT generation_job_media_position_nonnegative CHECK (position >= 0),
  CONSTRAINT generation_job_media_job_position_unique UNIQUE (generation_job_id, position)
);

CREATE INDEX page_versions_page_created_idx ON page_versions(project_id, page_id, created_at DESC);
CREATE INDEX generation_job_media_project_idx ON generation_job_media(project_id, media_asset_id);

CREATE FUNCTION prevent_page_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'page_versions are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER page_versions_immutable
  BEFORE UPDATE ON page_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_page_version_update();
