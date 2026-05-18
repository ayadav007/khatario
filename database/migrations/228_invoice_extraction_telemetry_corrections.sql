-- Deterministic extraction telemetry, field-level correction audit trail, and versioned adaptive config proposals.

CREATE TABLE IF NOT EXISTS invoice_extraction_telemetry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    extraction_job_id UUID NOT NULL REFERENCES invoice_extraction_jobs(id) ON DELETE CASCADE,
    invoice_id UUID NULL,
    supplier_hash VARCHAR(80),
    layout_fingerprint VARCHAR(128),
    parser_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
    extracted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    optimization_score DOUBLE PRECISION,
    subtotal_consistency JSONB NOT NULL DEFAULT '{}'::jsonb,
    gst_consistency JSONB NOT NULL DEFAULT '{}'::jsonb,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    suspicious_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
    rejected_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
    region_classifications JSONB NOT NULL DEFAULT '{}'::jsonb,
    ocr_confidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    extraction_duration_ms INTEGER,
    extras JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_invoice_extraction_telemetry_job UNIQUE (extraction_job_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_ext_telemetry_biz_extracted
    ON invoice_extraction_telemetry (business_id, extracted_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_ext_telemetry_supplier_hash
    ON invoice_extraction_telemetry (supplier_hash)
    WHERE supplier_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_ext_telemetry_layout_fp
    ON invoice_extraction_telemetry (layout_fingerprint)
    WHERE layout_fingerprint IS NOT NULL;

COMMENT ON TABLE invoice_extraction_telemetry IS
    'Structured deterministic metrics per extraction job (auditable; no raw OCR blobs).';

CREATE TABLE IF NOT EXISTS invoice_correction_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    extraction_job_id UUID REFERENCES invoice_extraction_jobs(id) ON DELETE SET NULL,
    invoice_id UUID NULL,
    supplier_hash VARCHAR(80),
    field_path TEXT NOT NULL,
    original_value JSONB,
    corrected_value JSONB,
    correction_type VARCHAR(80) NOT NULL,
    parser_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoice_correction_logs_business_created
    ON invoice_correction_logs (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_correction_logs_job
    ON invoice_correction_logs (extraction_job_id)
    WHERE extraction_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_correction_logs_supplier_hash
    ON invoice_correction_logs (supplier_hash)
    WHERE supplier_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_correction_logs_type
    ON invoice_correction_logs (correction_type, created_at DESC);

COMMENT ON TABLE invoice_correction_logs IS
    'Field-level user corrections from extraction review (deterministic paths / audit).';

CREATE TABLE IF NOT EXISTS adaptive_config_proposals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    proposal_version VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (
        status IN (
            'draft',
            'benchmark_pending',
            'benchmark_passed',
            'benchmark_failed',
            'pending_approval',
            'approved',
            'rejected',
            'promoted'
        )
    ),
    config_patch JSONB NOT NULL DEFAULT '{}'::jsonb,
    rationale TEXT,
    benchmark_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    regression_detected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_adaptive_proposal_version_nonempty CHECK (length(trim(proposal_version)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_adaptive_config_proposals_scope_version
    ON adaptive_config_proposals (COALESCE(business_id::text, '__platform__'), proposal_version);

CREATE INDEX IF NOT EXISTS idx_adaptive_config_proposals_status
    ON adaptive_config_proposals (status, created_at DESC);

CREATE TRIGGER update_adaptive_config_proposals_updated_at
    BEFORE UPDATE ON adaptive_config_proposals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE adaptive_config_proposals IS
    'Reviewable deterministic config patches — never auto-promoted without benchmarks + approval.';

CREATE TABLE IF NOT EXISTS adaptive_config_releases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    release_version VARCHAR(64) NOT NULL,
    proposal_id UUID REFERENCES adaptive_config_proposals(id) ON DELETE SET NULL,
    config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    promoted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    promoted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_adaptive_release_version_nonempty CHECK (length(trim(release_version)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_adaptive_config_releases_scope_version
    ON adaptive_config_releases (COALESCE(business_id::text, '__platform__'), release_version);

CREATE INDEX IF NOT EXISTS idx_adaptive_config_releases_business
    ON adaptive_config_releases (business_id, promoted_at DESC);

COMMENT ON TABLE adaptive_config_releases IS
    'Immutable snapshots of promoted deterministic configs (audit trail).';
