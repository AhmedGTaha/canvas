CREATE TABLE media_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id uuid,
  name varchar(120) NOT NULL,
  position integer NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT media_folders_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT media_folders_parent_project_fk FOREIGN KEY (parent_id, project_id) REFERENCES media_folders(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT media_folders_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT media_folders_position_nonnegative CHECK (position >= 0),
  CONSTRAINT media_folders_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX media_folders_project_parent_position_idx ON media_folders(project_id, parent_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX media_folders_root_name_unique ON media_folders(project_id, lower(name)) WHERE parent_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX media_folders_nested_name_unique ON media_folders(project_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  folder_id uuid,
  original_filename varchar(255) NOT NULL,
  display_name varchar(160) NOT NULL,
  storage_key text NOT NULL UNIQUE,
  mime_type varchar(32) NOT NULL,
  size_bytes bigint NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  alt_text varchar(500),
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT media_assets_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT media_assets_folder_project_fk FOREIGN KEY (folder_id, project_id) REFERENCES media_folders(id, project_id) ON DELETE RESTRICT,
  CONSTRAINT media_assets_original_name_not_blank CHECK (length(trim(original_filename)) > 0),
  CONSTRAINT media_assets_display_name_not_blank CHECK (length(trim(display_name)) > 0),
  CONSTRAINT media_assets_mime_supported CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT media_assets_size_positive CHECK (size_bytes > 0),
  CONSTRAINT media_assets_dimensions_positive CHECK (width > 0 AND height > 0)
);

CREATE INDEX media_assets_project_folder_created_idx ON media_assets(project_id, folder_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX media_assets_project_display_name_idx ON media_assets(project_id, lower(display_name)) WHERE deleted_at IS NULL;

ALTER TABLE project_brand_settings
  ADD CONSTRAINT project_brand_primary_logo_project_fk
    FOREIGN KEY (primary_logo_media_id, project_id) REFERENCES media_assets(id, project_id) ON DELETE RESTRICT,
  ADD CONSTRAINT project_brand_alternate_logo_project_fk
    FOREIGN KEY (alternate_logo_media_id, project_id) REFERENCES media_assets(id, project_id) ON DELETE RESTRICT;
