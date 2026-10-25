-- Trigram matching for meeting-title substring search (spec §5: tsvector + pg_trgm).
-- Extension name is a constant, never user input.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
