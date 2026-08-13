-- Retain a bounded, operator-safe validation reason on failed AI jobs. Candidate source
-- remains ephemeral; provider identifiers and token counts are already first-class job
-- fields and are populated as soon as a structured response is received.
ALTER TABLE generation_jobs ADD COLUMN error_diagnostic varchar(500);
