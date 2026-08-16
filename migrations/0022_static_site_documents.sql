-- Generated websites are static HTML, CSS, and vanilla JavaScript rather than React
-- components Canvas compiles. A Version now stores a validated document instead of a
-- single blob of TSX source.
--
-- Existing rows are not converted. Arbitrary React cannot be turned into equivalent HTML
-- without executing it, and executing model-authored code to migrate it would be a worse
-- risk than leaving it alone — so every pre-existing Version keeps its source verbatim,
-- is marked `react_tsx`, and becomes read-only history: it is still listed, still part of
-- Change Sets and Checkpoints, and still restorable as a record, but it is no longer
-- rendered, exported, or used as the baseline for an AI edit. Regenerating the page
-- produces a `static_html` Version and the project moves forward from there.
ALTER TABLE page_versions ADD COLUMN document jsonb;
ALTER TABLE page_versions ADD COLUMN source_format varchar(20) NOT NULL DEFAULT 'react_tsx';
ALTER TABLE page_versions ALTER COLUMN source_code DROP NOT NULL;
ALTER TABLE page_versions ALTER COLUMN source_format SET DEFAULT 'static_html';
ALTER TABLE page_versions ADD CONSTRAINT page_versions_content_present CHECK (
  (source_format = 'static_html' AND document IS NOT NULL)
  OR (source_format = 'react_tsx' AND source_code IS NOT NULL)
);

ALTER TABLE building_block_versions ADD COLUMN document jsonb;
ALTER TABLE building_block_versions ADD COLUMN source_format varchar(20) NOT NULL DEFAULT 'react_tsx';
ALTER TABLE building_block_versions ALTER COLUMN source_code DROP NOT NULL;
ALTER TABLE building_block_versions ALTER COLUMN source_format SET DEFAULT 'static_html';
ALTER TABLE building_block_versions ADD CONSTRAINT building_block_versions_content_present CHECK (
  (source_format = 'static_html' AND document IS NOT NULL)
  OR (source_format = 'react_tsx' AND source_code IS NOT NULL)
);

CREATE INDEX page_versions_format_idx ON page_versions (project_id, source_format);
CREATE INDEX building_block_versions_format_idx ON building_block_versions (project_id, source_format);
