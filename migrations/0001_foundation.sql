CREATE TYPE project_status AS ENUM ('active', 'archived', 'deleted');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  normalized_email text NOT NULL UNIQUE,
  display_name varchar(120) NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 0),
  CONSTRAINT users_normalized_email_is_lower CHECK (normalized_email = lower(trim(normalized_email)))
);

CREATE TABLE auth_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE auth_rate_limits (
  scope varchar(32) NOT NULL,
  subject_hash char(64) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject_hash),
  CONSTRAINT auth_rate_limits_attempt_count_positive CHECK (attempt_count > 0)
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT workspaces_id_owner_unique UNIQUE (id, owner_user_id)
);

CREATE INDEX workspaces_owner_user_id_idx ON workspaces(owner_user_id);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  name varchar(100) NOT NULL,
  description varchar(500),
  status project_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT projects_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT projects_workspace_owner_fk
    FOREIGN KEY (workspace_id, owner_user_id)
    REFERENCES workspaces(id, owner_user_id)
    ON DELETE RESTRICT,
  CONSTRAINT projects_deleted_state_consistent CHECK (
    (status = 'deleted' AND deleted_at IS NOT NULL)
    OR (status <> 'deleted' AND deleted_at IS NULL)
  )
);

CREATE INDEX projects_workspace_status_idx ON projects(workspace_id, status);
CREATE INDEX projects_owner_user_id_idx ON projects(owner_user_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version varchar(255) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
