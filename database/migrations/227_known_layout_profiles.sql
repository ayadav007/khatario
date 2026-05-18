-- Known layout fingerprints: curated / derived spatial cues for adaptive extraction prompts.
CREATE TABLE IF NOT EXISTS known_layout_profiles (
    layout_fingerprint VARCHAR(128) PRIMARY KEY,
    layout_extraction_strategy VARCHAR(28) NOT NULL DEFAULT 'GENERIC' CHECK (
        layout_extraction_strategy IN (
            'GENERIC',
            'KNOWN_LAYOUT',
            'KNOWN_VENDOR',
            'HIGH_CONFIDENCE_LAYOUT'
        )
    ),
    common_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    table_structures JSONB NOT NULL DEFAULT '{}'::jsonb,
    gst_anchor_regions JSONB NOT NULL DEFAULT '{}'::jsonb,
    totals_regions JSONB NOT NULL DEFAULT '{}'::jsonb,
    invoice_number_anchors JSONB NOT NULL DEFAULT '{}'::jsonb,
    hint_version SMALLINT NOT NULL DEFAULT 1,
    total_calibration_docs INTEGER NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_known_layout_profiles_strategy
    ON known_layout_profiles (layout_extraction_strategy);

CREATE INDEX IF NOT EXISTS idx_known_layout_profiles_updated
    ON known_layout_profiles (updated_at DESC NULLS LAST);

CREATE TRIGGER update_known_layout_profiles_updated_at
    BEFORE UPDATE ON known_layout_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE known_layout_profiles IS
    'Layout fingerprint intelligence: anchors and column cues for adaptive LLM prompting (references invoice_layout_profiles).';
