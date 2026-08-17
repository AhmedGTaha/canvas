-- Project typography: heading and body typefaces as first-class theme settings.
--
-- Stored as identifiers, never as CSS font-family strings, so a stylesheet can only ever
-- contain a stack the application itself owns. Existing projects take the system stacks,
-- which is exactly what they were already rendering with, so no visual change follows the
-- migration.
ALTER TABLE project_theme_settings
  ADD COLUMN IF NOT EXISTS heading_font varchar(40) NOT NULL DEFAULT 'system-sans',
  ADD COLUMN IF NOT EXISTS body_font varchar(40) NOT NULL DEFAULT 'system-sans';

ALTER TABLE project_theme_settings
  DROP CONSTRAINT IF EXISTS project_theme_heading_font_not_blank,
  DROP CONSTRAINT IF EXISTS project_theme_body_font_not_blank;

ALTER TABLE project_theme_settings
  ADD CONSTRAINT project_theme_heading_font_not_blank CHECK (length(trim(heading_font)) > 0),
  ADD CONSTRAINT project_theme_body_font_not_blank CHECK (length(trim(body_font)) > 0);
