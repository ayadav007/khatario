-- Migration 263: Candidate onboarding tasks (pre-offer info collection)

ALTER TABLE recruitment_candidates
  ADD COLUMN IF NOT EXISTS portal_invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS info_collection_completed_at TIMESTAMPTZ;

ALTER TABLE recruitment_candidates DROP CONSTRAINT IF EXISTS recruitment_candidates_status_check;
ALTER TABLE recruitment_candidates ADD CONSTRAINT recruitment_candidates_status_check
  CHECK (status IN (
    'applied', 'screening', 'interviewing', 'selected',
    'portal_invited', 'info_collection', 'info_collection_complete',
    'offer_draft', 'offer_sent', 'offer_viewed', 'offer_accepted', 'offer_declined',
    'docs_submitted', 'docs_verified', 'ready_to_join', 'joined', 'rejected', 'withdrawn'
  ));

CREATE TABLE IF NOT EXISTS candidate_onboarding_task_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    task_key VARCHAR(80) NOT NULL,
    name VARCHAR(200) NOT NULL,
    task_type VARCHAR(40) NOT NULL,
    phase VARCHAR(20) NOT NULL DEFAULT 'pre_offer'
        CHECK (phase IN ('pre_offer', 'post_offer')),
    is_required BOOLEAN NOT NULL DEFAULT true,
    due_days_after_invite INTEGER,
    instruction_text TEXT,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (business_id, task_key)
);

CREATE TABLE IF NOT EXISTS candidate_onboarding_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
    template_id UUID REFERENCES candidate_onboarding_task_templates(id) ON DELETE SET NULL,
    task_key VARCHAR(80) NOT NULL,
    name VARCHAR(200) NOT NULL,
    task_type VARCHAR(40) NOT NULL,
    phase VARCHAR(20) NOT NULL DEFAULT 'pre_offer',
    is_required BOOLEAN NOT NULL DEFAULT true,
    instruction_text TEXT,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'not_started'
        CHECK (status IN ('not_started', 'in_progress', 'submitted', 'changes_requested', 'approved')),
    candidate_self_status VARCHAR(30) NOT NULL DEFAULT 'not_started'
        CHECK (candidate_self_status IN ('not_started', 'in_progress', 'completed')),
    due_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id),
    reviewer_notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidate_identity_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
    document_key VARCHAR(40) NOT NULL,
    fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    file_name VARCHAR(255),
    file_url TEXT,
    mime_type VARCHAR(120),
    is_complete BOOLEAN NOT NULL DEFAULT false,
    saved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (candidate_id, document_key)
);

CREATE TABLE IF NOT EXISTS candidate_task_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES candidate_onboarding_tasks(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
    entry_key VARCHAR(80) NOT NULL,
    fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_complete BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (task_id, entry_key)
);

CREATE TABLE IF NOT EXISTS candidate_task_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES candidate_onboarding_tasks(id) ON DELETE CASCADE,
    entry_id UUID REFERENCES candidate_task_entries(id) ON DELETE CASCADE,
    identity_document_id UUID REFERENCES candidate_identity_documents(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    mime_type VARCHAR(120),
    file_size INTEGER,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_candidate
    ON candidate_onboarding_tasks (candidate_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_onboarding_templates_business
    ON candidate_onboarding_task_templates (business_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_candidate_identity_docs
    ON candidate_identity_documents (candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_task_entries_task
    ON candidate_task_entries (task_id);
CREATE INDEX IF NOT EXISTS idx_candidate_task_files_task
    ON candidate_task_files (task_id);

COMMENT ON TABLE candidate_onboarding_task_templates IS 'Reusable onboarding checklist items per business';
COMMENT ON TABLE candidate_onboarding_tasks IS 'Assigned onboarding tasks for a candidate';
COMMENT ON TABLE candidate_identity_documents IS 'Structured KYC data shared across tasks (Aadhaar, PAN, etc.)';
