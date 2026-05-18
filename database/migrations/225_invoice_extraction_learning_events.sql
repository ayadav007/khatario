-- Invoice extraction learning events (privacy-conscious aggregates for improving parsers).
-- No raw OCR text or invoice images stored here.

CREATE TABLE IF NOT EXISTS invoice_extraction_learning_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    extraction_job_id UUID REFERENCES invoice_extraction_jobs(id) ON DELETE SET NULL,
    event_type VARCHAR(32) NOT NULL CHECK (
        event_type IN ('parse_complete', 'user_review_accept')
    ),
    layout_fingerprint VARCHAR(128),
    spatial_profile JSONB,
    metrics JSONB NOT NULL DEFAULT '{}',
    correction_summary JSONB,
    parser_engine_version VARCHAR(64) NOT NULL DEFAULT 'spatial_semantic_opt_v1',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoice_learning_business_created
    ON invoice_extraction_learning_events(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_learning_job
    ON invoice_extraction_learning_events(extraction_job_id)
    WHERE extraction_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_learning_event_type
    ON invoice_extraction_learning_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_learning_fingerprint
    ON invoice_extraction_learning_events(layout_fingerprint)
    WHERE layout_fingerprint IS NOT NULL;

COMMENT ON TABLE invoice_extraction_learning_events IS
    'Deterministic telemetry + user correction summaries for invoice extraction quality (no raw OCR blob).';

COMMENT ON COLUMN invoice_extraction_learning_events.layout_fingerprint IS
    'Stable hash over layout geometry stats for clustering similar invoices';

COMMENT ON COLUMN invoice_extraction_learning_events.correction_summary IS
    'Aggregated field-edit counts when user accepts review (optional for parse_complete)';
