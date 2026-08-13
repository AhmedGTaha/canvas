-- Export artifacts are prunable: the job row (and its validation history) is kept, but
-- the stored ZIP can be released once it is no longer worth retaining.
ALTER TABLE export_jobs ADD COLUMN artifact_pruned_at timestamptz;
ALTER TABLE export_jobs DROP CONSTRAINT export_jobs_completed_artifact;
ALTER TABLE export_jobs ADD CONSTRAINT export_jobs_completed_artifact CHECK (
  status <> 'completed' OR artifact_storage_key IS NOT NULL OR artifact_pruned_at IS NOT NULL
);
ALTER TABLE export_jobs DROP CONSTRAINT export_jobs_artifact_requires_completion;
ALTER TABLE export_jobs ADD CONSTRAINT export_jobs_artifact_requires_completion CHECK (
  artifact_storage_key IS NULL OR status = 'completed'
);
ALTER TABLE export_jobs ADD CONSTRAINT export_jobs_pruned_releases_key CHECK (
  artifact_pruned_at IS NULL OR artifact_storage_key IS NULL
);

-- Builder and Blocks poll the newest job for one target while a generation runs.
CREATE INDEX generation_jobs_target_created_idx ON generation_jobs(project_id, target_id, created_at DESC);

-- Export workers recover jobs abandoned by a crashed process.
CREATE INDEX export_jobs_recovery_idx ON export_jobs(status, claimed_at)
  WHERE status IN ('validating', 'assembling', 'building', 'packaging');
