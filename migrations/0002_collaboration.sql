CREATE TYPE project_role AS ENUM ('owner', 'collaborator');
CREATE TYPE lease_target_type AS ENUM ('page', 'building_block');

-- projects.owner_user_id remains the only source of truth for ownership.
-- Membership rows intentionally represent collaborators only.
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role project_role NOT NULL DEFAULT 'collaborator',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT project_members_collaborator_only CHECK (role = 'collaborator')
);

CREATE INDEX project_members_user_id_idx ON project_members(user_id);

CREATE TABLE project_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_invites_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX project_invites_project_id_idx ON project_invites(project_id);
CREATE UNIQUE INDEX project_invites_one_unrevoked_idx ON project_invites(project_id) WHERE revoked_at IS NULL;

CREATE TABLE editing_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_type lease_target_type NOT NULL,
  target_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, target_type, target_id)
);

CREATE INDEX editing_leases_expires_at_idx ON editing_leases(expires_at);
CREATE INDEX editing_leases_user_id_idx ON editing_leases(user_id);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(80) NOT NULL,
  entity_type varchar(40) NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_project_created_idx ON audit_events(project_id, created_at DESC);
