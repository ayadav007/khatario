-- Migration 266: Offer letter internal approvals, signatures, extended offer fields

ALTER TABLE recruitment_offer_letters
  DROP CONSTRAINT IF EXISTS recruitment_offer_letters_status_check;

ALTER TABLE recruitment_offer_letters
  ADD CONSTRAINT recruitment_offer_letters_status_check
  CHECK (status IN (
    'draft', 'pending_approval', 'approved', 'approval_rejected',
    'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn'
  ));

ALTER TABLE recruitment_offer_letters
  ADD COLUMN IF NOT EXISTS candidate_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS signatory_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS signatory_title VARCHAR(200),
  ADD COLUMN IF NOT EXISTS work_location VARCHAR(200),
  ADD COLUMN IF NOT EXISTS annual_bonus DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notice_period_days INTEGER,
  ADD COLUMN IF NOT EXISTS submitted_for_approval_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS internally_approved_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS recruitment_offer_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_id UUID NOT NULL REFERENCES recruitment_offer_letters(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    approval_level INTEGER NOT NULL,
    level_label VARCHAR(120),
    approver_user_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    comments TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (offer_id, approval_level)
);

CREATE INDEX IF NOT EXISTS idx_recruitment_offer_approvals_offer
    ON recruitment_offer_approvals(offer_id, approval_level);

CREATE INDEX IF NOT EXISTS idx_recruitment_offer_approvals_approver
    ON recruitment_offer_approvals(approver_user_id, status)
    WHERE status = 'pending';

COMMENT ON TABLE recruitment_offer_approvals IS
    'Per-offer sequential approval chain; approvers picked by HR when submitting each offer';
