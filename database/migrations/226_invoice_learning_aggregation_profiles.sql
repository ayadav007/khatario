-- Phase 1: Offline aggregates for invoice extraction learning (privacy-preserving hashed vendor keys).
-- Source of truth remains invoice_extraction_learning_events.

CREATE TABLE IF NOT EXISTS invoice_layout_profiles (
    layout_fingerprint VARCHAR(128) PRIMARY KEY,
    total_documents INTEGER NOT NULL DEFAULT 0,
    accepted_documents INTEGER NOT NULL DEFAULT 0,
    acceptance_rate NUMERIC(10, 6),
    avg_processing_ms NUMERIC(14, 2),
    avg_confidence NUMERIC(10, 6),
    correction_rate NUMERIC(10, 6),
    common_error_fields JSONB NOT NULL DEFAULT '{}',
    last_seen_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_vendor_profiles (
    vendor_key VARCHAR(136) PRIMARY KEY,
    vendor_name_hash VARCHAR(64) NOT NULL,
    gstin_hash VARCHAR(64),
    known_layout_fingerprints TEXT[] NOT NULL DEFAULT '{}'::text[],
    avg_confidence NUMERIC(10, 6),
    avg_correction_rate NUMERIC(10, 6),
    preferred_column_patterns JSONB NOT NULL DEFAULT '{}',
    common_headers JSONB NOT NULL DEFAULT '{}',
    total_documents INTEGER NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_field_learning (
    field_name VARCHAR(128) PRIMARY KEY,
    total_occurrences INTEGER NOT NULL DEFAULT 0,
    corrected_occurrences INTEGER NOT NULL DEFAULT 0,
    correction_rate NUMERIC(10, 6),
    avg_confidence NUMERIC(10, 6),
    common_replacement_patterns JSONB NOT NULL DEFAULT '{}',
    last_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoice_learning_fingerprint_created
    ON invoice_extraction_learning_events (layout_fingerprint, created_at DESC)
    WHERE layout_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_layout_profiles_last_seen
    ON invoice_layout_profiles (last_seen_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_invoice_layout_profiles_created_at
    ON invoice_layout_profiles (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_vendor_profiles_name_hash
    ON invoice_vendor_profiles (vendor_name_hash);

CREATE INDEX IF NOT EXISTS idx_invoice_vendor_profiles_gstin_hash
    ON invoice_vendor_profiles (gstin_hash)
    WHERE gstin_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_vendor_profiles_last_seen
    ON invoice_vendor_profiles (last_seen_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_invoice_field_learning_correction
    ON invoice_field_learning (correction_rate DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_invoice_field_learning_last_updated
    ON invoice_field_learning (last_updated_at DESC);

CREATE TRIGGER update_invoice_layout_profiles_updated_at
    BEFORE UPDATE ON invoice_layout_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoice_vendor_profiles_updated_at
    BEFORE UPDATE ON invoice_vendor_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE invoice_layout_profiles IS
    'Nightly rollup: layout fingerprints x parse + review telemetry (full refresh).';

COMMENT ON TABLE invoice_vendor_profiles IS
    'Nightly rollup: vendor keyed by cryptographic hashes only (full refresh).';

COMMENT ON TABLE invoice_field_learning IS
    'Nightly rollup: corrected field frequencies from review summaries (full refresh).';
