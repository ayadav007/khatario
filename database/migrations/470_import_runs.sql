-- Migration 470: spreadsheet import runs ("Move to Khatario").
-- Description: One import_runs row per uploaded file. A run starts as a 'draft' holding the
-- file's rows (draft_rows) and the user's own row numbers (row_numbers); the preview stores the
-- column and value matches on it; commit saves rows in batches, advancing `cursor` one row at a
-- time, and records every created master in import_run_records so the run can be undone.
-- draft_rows and row_numbers are cleared when the run is done. Rows that were not imported are
-- kept in problem_rows (cells, row number, reason) for the "download problem rows" file.
-- import_column_matches remembers which field each header was matched to, per business and
-- section, so the next upload of the same layout is matched automatically.
-- Draft runs older than 24 hours are deleted by the application when the business starts a new one.
-- No existing row is changed. Safe to run more than once.
-- Created: 2026-11-10

CREATE TABLE IF NOT EXISTS import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  source_app TEXT NOT NULL,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'committing', 'done', 'undone', 'failed')),
  headers JSONB NOT NULL,
  header_row_number INT NOT NULL,
  first_data_row_number INT NOT NULL,
  draft_rows JSONB,
  -- 1-based row in the user's file of draft_rows[i] (blank and total rows are dropped).
  row_numbers JSONB,
  column_matches JSONB,
  value_matches JSONB NOT NULL DEFAULT '{}',
  date_order TEXT NOT NULL DEFAULT 'dmy',
  -- Index of the next row to process; rows before it are saved or recorded as problems.
  cursor INT NOT NULL DEFAULT 0,
  -- { total, saved, skipped, failed }
  counts JSONB NOT NULL DEFAULT '{}',
  problem_rows JSONB NOT NULL DEFAULT '[]',
  -- No foreign key: removing a user must not touch import history.
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_import_runs_business_section_created
  ON import_runs (business_id, section, created_at DESC);

CREATE TABLE IF NOT EXISTS import_run_records (
  run_id UUID NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  business_id UUID NOT NULL,
  record_table TEXT NOT NULL,
  record_id UUID NOT NULL,
  row_number INT NOT NULL,
  undone_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, record_table, record_id)
);

CREATE TABLE IF NOT EXISTS import_column_matches (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  -- normaliseKey(header) as read from the file.
  header_key TEXT NOT NULL,
  -- NULL: the user chose "Don't import" for this header.
  field_key TEXT,
  PRIMARY KEY (business_id, section, header_key)
);
