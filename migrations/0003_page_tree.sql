CREATE TYPE page_node_type AS ENUM ('page', 'folder');

CREATE TABLE page_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id uuid,
  type page_node_type NOT NULL,
  name varchar(120) NOT NULL,
  slug varchar(100),
  route_path varchar(1000),
  position integer NOT NULL,
  is_homepage boolean NOT NULL DEFAULT false,
  page_title varchar(100),
  meta_description varchar(300),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT page_nodes_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT page_nodes_parent_same_project_fk
    FOREIGN KEY (parent_id, project_id)
    REFERENCES page_nodes(id, project_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT page_nodes_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT page_nodes_position_nonnegative CHECK (position >= 0),
  CONSTRAINT page_nodes_type_fields CHECK (
    (type = 'folder' AND slug IS NULL AND route_path IS NULL AND is_homepage = false AND page_title IS NULL AND meta_description IS NULL)
    OR
    (type = 'page' AND slug IS NOT NULL AND route_path IS NOT NULL)
  ),
  CONSTRAINT page_nodes_slug_format CHECK (slug IS NULL OR slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT page_nodes_route_format CHECK (route_path IS NULL OR route_path = '/' OR route_path ~ '^/[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$'),
  CONSTRAINT page_nodes_homepage_route CHECK (is_homepage = false OR (type = 'page' AND route_path = '/'))
);

CREATE INDEX page_nodes_project_parent_position_idx ON page_nodes(project_id, parent_id, position) WHERE deleted_at IS NULL;
CREATE INDEX page_nodes_parent_id_idx ON page_nodes(parent_id);
CREATE UNIQUE INDEX page_nodes_active_route_unique ON page_nodes(project_id, route_path) WHERE deleted_at IS NULL AND type = 'page';
CREATE UNIQUE INDEX page_nodes_one_homepage_idx ON page_nodes(project_id) WHERE deleted_at IS NULL AND is_homepage = true;
