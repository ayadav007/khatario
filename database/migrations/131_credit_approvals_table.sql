-- Migration: Credit Approvals System (Phase 5.1)
-- Purpose: Enable approval-based override for over-credit invoices/purchases

-- Create credit_approvals table
CREATE TABLE IF NOT EXISTS credit_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('customer', 'supplier')),
    entity_id UUID NOT NULL,
    reference_type VARCHAR(20) NOT NULL CHECK (reference_type IN ('invoice', 'purchase')),
    reference_id UUID NOT NULL,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_credit_approvals_business ON credit_approvals(business_id, status);
CREATE INDEX IF NOT EXISTS idx_credit_approvals_reference ON credit_approvals(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_credit_approvals_entity ON credit_approvals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_credit_approvals_status ON credit_approvals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_approvals_requested_by ON credit_approvals(requested_by);
CREATE INDEX IF NOT EXISTS idx_credit_approvals_approved_by ON credit_approvals(approved_by);

-- Prevent duplicate pending requests for same reference (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_approvals_unique_pending
    ON credit_approvals(business_id, reference_type, reference_id)
    WHERE status = 'pending';

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_credit_approvals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_credit_approvals_updated_at
    BEFORE UPDATE ON credit_approvals
    FOR EACH ROW
    EXECUTE FUNCTION update_credit_approvals_updated_at();

COMMENT ON TABLE credit_approvals IS 'Tracks credit limit override approvals for invoices and purchases';
COMMENT ON COLUMN credit_approvals.entity_type IS 'Type of party: customer or supplier';
COMMENT ON COLUMN credit_approvals.reference_type IS 'Type of document: invoice or purchase';
COMMENT ON COLUMN credit_approvals.status IS 'Approval status: pending, approved, or rejected';
COMMENT ON COLUMN credit_approvals.reason IS 'Reason for approval request or rejection';
