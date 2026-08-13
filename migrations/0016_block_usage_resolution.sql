-- Per-page attach/detach of a Building Block records its own Change Set so the
-- History activity feed shows it. It is audit-only: Undo replays version moves,
-- and a usage's resolution is not one, so the operation stays outside
-- REVERSIBLE_OPERATIONS and its Change Sets are written non-reversible.
ALTER TYPE change_set_operation ADD VALUE IF NOT EXISTS 'block_usage_resolution';
