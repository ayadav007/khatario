-- Migration 259: HR recruitment, offer letters, candidate portal, onboarding

INSERT INTO permission_modules (module_key, module_name, description, display_order)
VALUES ('recruitment', 'Recruitment', 'Jobs, candidates, interviews, and offers', 19)
ON CONFLICT (module_key) DO NOTHING;

-- Grant recruitment permissions to HR roles (skip if already present)
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'recruitment', true, true, true, true, false
FROM user_roles ur
WHERE ur.role_key IN ('primary_admin', 'hr_admin')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = ur.id AND rp.module_key = 'recruitment'
  );

INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'recruitment', true, true, true, false, false
FROM user_roles ur
WHERE ur.role_key = 'team_lead'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = ur.id AND rp.module_key = 'recruitment'
  );

CREATE TABLE IF NOT EXISTS recruitment_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    department VARCHAR(120),
    description TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'open'
        CHECK (status IN ('draft', 'open', 'on_hold', 'closed')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recruitment_job_interview_stages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES recruitment_jobs(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    stage_name VARCHAR(120) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job_id, stage_name)
);

CREATE TABLE IF NOT EXISTS recruitment_candidates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES recruitment_jobs(id) ON DELETE CASCADE,
    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    source VARCHAR(120),
    status VARCHAR(40) NOT NULL DEFAULT 'applied'
        CHECK (status IN (
            'applied', 'screening', 'interviewing', 'selected',
            'offer_draft', 'offer_sent', 'offer_viewed', 'offer_accepted', 'offer_declined',
            'docs_submitted', 'docs_verified', 'ready_to_join', 'joined', 'rejected', 'withdrawn'
        )),
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (business_id, job_id, email)
);

CREATE TABLE IF NOT EXISTS recruitment_interviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES recruitment_job_interview_stages(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMPTZ,
    location_or_link TEXT,
    interviewer_user_id UUID REFERENCES users(id),
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'completed', 'passed', 'failed', 'no_show', 'cancelled', 'rescheduled')),
    feedback TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recruitment_offer_letters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
    designation VARCHAR(120) NOT NULL,
    department VARCHAR(120),
    joining_date DATE NOT NULL,
    probation_months INTEGER DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn')),
    -- Salary components (copied to salary_structures on join)
    basic_salary DECIMAL(12,2) NOT NULL,
    hra DECIMAL(12,2) DEFAULT 0,
    transport_allowance DECIMAL(12,2) DEFAULT 0,
    medical_allowance DECIMAL(12,2) DEFAULT 0,
    special_allowance DECIMAL(12,2) DEFAULT 0,
    other_allowances DECIMAL(12,2) DEFAULT 0,
    pf_percentage DECIMAL(5,2) DEFAULT 12.00,
    pf_fixed_amount DECIMAL(12,2),
    professional_tax DECIMAL(12,2) DEFAULT 0,
    tds_percentage DECIMAL(5,2) DEFAULT 0,
    other_deductions DECIMAL(12,2) DEFAULT 0,
    terms_text TEXT,
    sent_at TIMESTAMPTZ,
    viewed_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    accepted_ip VARCHAR(64),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidate_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
    document_type VARCHAR(80) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidate_portal_otps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_candidate_portal_otps_lookup
    ON candidate_portal_otps (business_id, lower(trim(email)), created_at DESC);

CREATE TABLE IF NOT EXISTS candidate_portal_sessions (
    session_token VARCHAR(128) PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recruitment_jobs_business ON recruitment_jobs(business_id);
CREATE INDEX IF NOT EXISTS idx_recruitment_candidates_business ON recruitment_candidates(business_id);
CREATE INDEX IF NOT EXISTS idx_recruitment_candidates_job ON recruitment_candidates(job_id);
CREATE INDEX IF NOT EXISTS idx_recruitment_interviews_candidate ON recruitment_interviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_recruitment_offers_candidate ON recruitment_offer_letters(candidate_id);

COMMENT ON TABLE recruitment_jobs IS 'Open positions with custom interview stage templates per job';
COMMENT ON TABLE recruitment_candidates IS 'Applicants; converts to employee on manual join action';
