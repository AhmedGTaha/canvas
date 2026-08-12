CREATE TABLE project_brand_settings (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  company_name varchar(120) NOT NULL,
  company_description varchar(2000),
  brand_notes varchar(4000),
  primary_logo_media_id uuid,
  alternate_logo_media_id uuid,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_brand_company_name_not_blank CHECK (length(trim(company_name)) > 0),
  CONSTRAINT project_brand_revision_positive CHECK (revision > 0)
);

CREATE TABLE project_theme_settings (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  light_tokens jsonb NOT NULL,
  dark_tokens jsonb NOT NULL,
  radius_scale smallint NOT NULL DEFAULT 50,
  spacing_scale smallint NOT NULL DEFAULT 50,
  shadow_scale smallint NOT NULL DEFAULT 50,
  font_scale smallint NOT NULL DEFAULT 50,
  border_scale smallint NOT NULL DEFAULT 50,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_theme_light_object CHECK (jsonb_typeof(light_tokens) = 'object'),
  CONSTRAINT project_theme_dark_object CHECK (jsonb_typeof(dark_tokens) = 'object'),
  CONSTRAINT project_theme_radius_range CHECK (radius_scale BETWEEN 0 AND 100),
  CONSTRAINT project_theme_spacing_range CHECK (spacing_scale BETWEEN 0 AND 100),
  CONSTRAINT project_theme_shadow_range CHECK (shadow_scale BETWEEN 0 AND 100),
  CONSTRAINT project_theme_font_range CHECK (font_scale BETWEEN 0 AND 100),
  CONSTRAINT project_theme_border_range CHECK (border_scale BETWEEN 0 AND 100),
  CONSTRAINT project_theme_revision_positive CHECK (revision > 0)
);

INSERT INTO project_brand_settings (project_id, company_name)
SELECT id, name FROM projects
ON CONFLICT (project_id) DO NOTHING;

INSERT INTO project_theme_settings (project_id, light_tokens, dark_tokens)
SELECT
  id,
  '{"primary":"#111111","secondary":"#6B7280","accent":"#2563EB","background":"#FFFFFF","surface":"#F8F9FA","text":"#111111","mutedText":"#6B7280","border":"#E5E7EB"}'::jsonb,
  '{"primary":"#F5F5F5","secondary":"#A1A1AA","accent":"#60A5FA","background":"#0A0A0A","surface":"#171717","text":"#F5F5F5","mutedText":"#A1A1AA","border":"#2A2A2A"}'::jsonb
FROM projects
ON CONFLICT (project_id) DO NOTHING;
