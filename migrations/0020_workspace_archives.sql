ALTER TABLE workspaces ADD COLUMN archived_at timestamptz;

CREATE INDEX workspaces_owner_archived_idx ON workspaces(owner_user_id, archived_at)
  WHERE archived_at IS NULL;
