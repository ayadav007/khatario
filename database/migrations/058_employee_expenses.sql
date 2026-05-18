-- Migration 058: Employee Expense Management
-- Handles expense submission, categories, approval, and reimbursement

-- Expense categories (already exists, but adding fields if needed)
-- ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS requires_receipt BOOLEAN DEFAULT true;
-- ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS max_amount DECIMAL(12,2);
-- ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT true;

-- Employee expenses
CREATE TABLE IF NOT EXISTS employee_expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    expense_category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
    expense_date DATE NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    description TEXT NOT NULL,
    payment_mode VARCHAR(50), -- 'cash', 'card', 'upi', 'bank_transfer', 'other'
    vendor_name VARCHAR(255), -- For vendor expenses
    receipt_url TEXT, -- URL to uploaded receipt/image
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'reimbursed', 'cancelled'
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    rejected_at TIMESTAMP,
    reimbursed_at TIMESTAMP,
    reimbursement_reference VARCHAR(100), -- Payment reference for reimbursement
    is_billable BOOLEAN DEFAULT false, -- Can be billed to customer/project
    billable_to_customer_id UUID REFERENCES customers(id), -- If billable to customer
    billable_to_project VARCHAR(255), -- If billable to project
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Expense approval workflow (for multi-level approvals)
CREATE TABLE IF NOT EXISTS expense_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_id UUID REFERENCES employee_expenses(id) ON DELETE CASCADE,
    approver_id UUID REFERENCES employees(id),
    approval_level INTEGER DEFAULT 1, -- 1, 2, 3, etc.
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    comments TEXT,
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Expense comments/notes
CREATE TABLE IF NOT EXISTS expense_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_id UUID REFERENCES employee_expenses(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id),
    comment_text TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT false, -- Internal notes not visible to employee
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Expense attachments (multiple files per expense)
CREATE TABLE IF NOT EXISTS expense_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_id UUID REFERENCES employee_expenses(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_type VARCHAR(50), -- 'receipt', 'invoice', 'other'
    file_size INTEGER, -- Size in bytes
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_expenses_employee ON employee_expenses(employee_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON employee_expenses(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON employee_expenses(expense_category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON employee_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expense_approvals_expense ON expense_approvals(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_approvals_approver ON expense_approvals(approver_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_comments_expense ON expense_comments(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_expense ON expense_attachments(expense_id);

-- Triggers
CREATE TRIGGER update_employee_expenses_updated_at
    BEFORE UPDATE ON employee_expenses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate total expenses for an employee in a period
CREATE OR REPLACE FUNCTION calculate_employee_expenses(
    p_employee_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_status VARCHAR DEFAULT 'approved'
)
RETURNS DECIMAL(12,2) AS $$
DECLARE
    v_total DECIMAL(12,2);
BEGIN
    SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM employee_expenses
    WHERE employee_id = p_employee_id
    AND expense_date BETWEEN p_start_date AND p_end_date
    AND (p_status IS NULL OR status = p_status);
    
    RETURN v_total;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE employee_expenses IS 'Employee expense submissions';
COMMENT ON TABLE expense_approvals IS 'Multi-level expense approval workflow';
COMMENT ON TABLE expense_comments IS 'Comments and notes on expenses';
COMMENT ON TABLE expense_attachments IS 'Multiple file attachments for expenses';

