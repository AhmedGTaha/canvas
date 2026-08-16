-- AI credentials belong to a person, not to a workspace or a project.
--
-- The rule this schema now enforces is that the credentials spent on an AI job are the
-- credentials of the person who created that job. A collaborator generating a page uses
-- their own key and their own credit; the owner's key is never reachable from another
-- member's request, and no fallback to someone else's credential exists anywhere.
--
-- Migration determinism. Connections were workspace-scoped but only ever creatable and
-- readable by the workspace owner, so the owner is the unambiguous new holder; where a
-- workspace row is somehow missing, the recorded creator is used instead. Project model
-- selections collapse into one selection per person: for each user, the most recently
-- updated project selection that pointed at a connection they now own, with the project
-- id as a deterministic tiebreaker. No credential is read, moved, or re-encrypted here —
-- ciphertext is bound to the connection id, which does not change.

ALTER TABLE ai_connections ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE CASCADE;
UPDATE ai_connections c SET user_id = COALESCE(w.owner_user_id, c.created_by_user_id)
  FROM workspaces w WHERE w.id = c.workspace_id;
UPDATE ai_connections SET user_id = created_by_user_id WHERE user_id IS NULL;
ALTER TABLE ai_connections ALTER COLUMN user_id SET NOT NULL;

DROP INDEX IF EXISTS ai_connections_workspace_name_unique;
DROP INDEX IF EXISTS ai_connections_workspace_idx;
ALTER TABLE ai_connections DROP CONSTRAINT IF EXISTS ai_connections_id_workspace_unique;
-- The workspace id is kept, without its foreign key, for exactly one reason: existing
-- ciphertext is bound to it as additional authenticated data. Dropping the column would
-- make every stored key permanently unreadable and force everyone to re-enter their API
-- key. New credentials are written bound to the owning account instead, and a rotated
-- key stops depending on this column; it is dead weight only, never authorisation.
ALTER TABLE ai_connections DROP CONSTRAINT IF EXISTS ai_connections_workspace_id_fkey;
ALTER TABLE ai_connections ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE ai_connections RENAME COLUMN workspace_id TO legacy_workspace_id;
ALTER TABLE ai_connections ADD CONSTRAINT ai_connections_id_user_unique UNIQUE (id, user_id);
CREATE INDEX ai_connections_user_idx ON ai_connections (user_id, created_at);
-- One live connection name per account; removed connections keep their history rows.
CREATE UNIQUE INDEX ai_connections_user_name_unique ON ai_connections (user_id, lower(name)) WHERE deleted_at IS NULL;

ALTER TABLE ai_connection_models ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE CASCADE;
UPDATE ai_connection_models m SET user_id = c.user_id FROM ai_connections c WHERE c.id = m.connection_id;
DELETE FROM ai_connection_models WHERE user_id IS NULL;
ALTER TABLE ai_connection_models ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE ai_connection_models DROP COLUMN workspace_id;
CREATE INDEX ai_connection_models_user_idx ON ai_connection_models (user_id, enabled);

-- One AI selection per account. The references are cleared rather than cascading, so
-- removing a connection leaves the account intact and the next job fails with a normal
-- configuration error instead of silently using something else.
CREATE TABLE user_ai_settings (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  connection_id uuid REFERENCES ai_connections (id) ON DELETE SET NULL,
  model_id uuid REFERENCES ai_connection_models (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO user_ai_settings (user_id, connection_id, model_id)
SELECT DISTINCT ON (c.user_id) c.user_id, s.connection_id, s.model_id
FROM project_ai_settings s
JOIN ai_connections c ON c.id = s.connection_id
JOIN ai_connection_models m ON m.id = s.model_id AND m.connection_id = c.id
WHERE c.deleted_at IS NULL
ORDER BY c.user_id, s.updated_at DESC, s.project_id ASC
ON CONFLICT (user_id) DO NOTHING;

DROP TABLE project_ai_settings;

-- A test-console request now comes from an account screen rather than from inside a
-- project, so a usage row can legitimately belong to no workspace.
ALTER TABLE ai_usage_events ALTER COLUMN workspace_id DROP NOT NULL;
