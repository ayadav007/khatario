-- Migration 062: Salary Management System
-- Creates tables for salary payments, advances, payslips, and salary structures

-- Salary Structures (defines salary components for each employee)
CREATE TABLE IF NOT EXISTS salary_structures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    
    -- Earnings Components
    basic_salary DECIMAL(12,2) NOT NULL,
    hra DECIMAL(12,2) DEFAULT 0, -- House Rent Allowance
    transport_allowance DECIMAL(12,2) DEFAULT 0,
    medical_allowance DECIMAL(12,2) DEFAULT 0,
    special_allowance DECIMAL(12,2) DEFAULT 0,
    other_allowances DECIMAL(12,2) DEFAULT 0,
    
    -- Deduction Components (as percentages or fixed amounts)
    pf_percentage DECIMAL(5,2) DEFAULT 12.00, -- Provident Fund percentage
    pf_fixed_amount DECIMAL(12,2), -- Fixed PF amount (if applicable)
    professional_tax DECIMAL(12,2) DEFAULT 0,
    tds_percentage DECIMAL(5,2) DEFAULT 0, -- Tax Deducted at Source
    other_deductions DECIMAL(12,2) DEFAULT 0,
    
    -- Effective Dates
    effective_from DATE NOT NULL,
    effective_to DATE, -- NULL means currently active
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(employee_id, effective_from)
);

-- Salary Payments (records of actual salary payments)
CREATE TABLE IF NOT EXISTS salary_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    
    -- Salary Period
    salary_month VARCHAR(20) NOT NULL, -- Format: "2024-02" or "February 2024"
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    payment_date DATE NOT NULL,
    
    -- Earnings (Actual amounts paid)
    basic_salary DECIMAL(12,2) NOT NULL,
    hra DECIMAL(12,2) DEFAULT 0,
    transport_allowance DECIMAL(12,2) DEFAULT 0,
    medical_allowance DECIMAL(12,2) DEFAULT 0,
    special_allowance DECIMAL(12,2) DEFAULT 0,
    overtime DECIMAL(12,2) DEFAULT 0,
    bonus DECIMAL(12,2) DEFAULT 0,
    commission DECIMAL(12,2) DEFAULT 0,
    other_earnings DECIMAL(12,2) DEFAULT 0,
    total_earnings DECIMAL(12,2) NOT NULL,
    
    -- Deductions
    provident_fund DECIMAL(12,2) DEFAULT 0,
    professional_tax DECIMAL(12,2) DEFAULT 0,
    tds DECIMAL(12,2) DEFAULT 0,
    advance_recovery DECIMAL(12,2) DEFAULT 0,
    loan_deduction DECIMAL(12,2) DEFAULT 0,
    other_deductions DECIMAL(12,2) DEFAULT 0,
    total_deductions DECIMAL(12,2) DEFAULT 0,
    
    -- Summary
    gross_salary DECIMAL(12,2) NOT NULL,
    net_salary DECIMAL(12,2) NOT NULL,
    
    -- Payment Details
    payment_mode VARCHAR(50), -- 'bank_transfer', 'cash', 'cheque', 'upi'
    payment_reference VARCHAR(100),
    bank_account_number VARCHAR(50),
    bank_ifsc VARCHAR(20),
    
    -- Attendance Summary (optional)
    working_days INTEGER,
    present_days INTEGER,
    absent_days INTEGER,
    leave_days INTEGER,
    overtime_hours DECIMAL(5,2),
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processed', 'paid', 'cancelled'
    processed_at TIMESTAMP,
    processed_by UUID REFERENCES users(id),
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(business_id, employee_id, salary_month)
);

-- Salary Advances
CREATE TABLE IF NOT EXISTS salary_advances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    
    -- Advance Details
    advance_amount DECIMAL(12,2) NOT NULL,
    advance_date DATE NOT NULL,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'recovered', 'partially_recovered'
    
    -- Recovery Details
    recovery_method VARCHAR(20) DEFAULT 'salary_deduction', -- 'salary_deduction', 'one_time_payment'
    recovery_months INTEGER, -- Number of months to recover (NULL = recover in next salary)
    recovered_amount DECIMAL(12,2) DEFAULT 0,
    remaining_amount DECIMAL(12,2) NOT NULL, -- Calculated: advance_amount - recovered_amount
    
    -- Approval
    requested_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    
    -- Payment
    payment_mode VARCHAR(50), -- 'cash', 'bank_transfer', 'upi', 'cheque'
    payment_reference VARCHAR(100),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Advance Recovery Records (tracks each deduction from salary)
CREATE TABLE IF NOT EXISTS advance_recoveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    advance_id UUID REFERENCES salary_advances(id) ON DELETE CASCADE,
    salary_payment_id UUID REFERENCES salary_payments(id) ON DELETE SET NULL,
    recovery_amount DECIMAL(12,2) NOT NULL,
    recovery_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payslips
CREATE TABLE IF NOT EXISTS payslips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    salary_payment_id UUID REFERENCES salary_payments(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    
    -- Payslip Data (stored as JSON for flexibility)
    payslip_data JSONB NOT NULL,
    
    -- Generated Files
    html_content TEXT,
    pdf_url TEXT,
    
    -- Status
    is_sent BOOLEAN DEFAULT false,
    sent_at TIMESTAMP,
    sent_to_email VARCHAR(255),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_salary_structures_business_id ON salary_structures(business_id);
CREATE INDEX IF NOT EXISTS idx_salary_structures_employee_id ON salary_structures(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_structures_effective_from ON salary_structures(effective_from);

CREATE INDEX IF NOT EXISTS idx_salary_payments_business_id ON salary_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_employee_id ON salary_payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_salary_month ON salary_payments(salary_month);
CREATE INDEX IF NOT EXISTS idx_salary_payments_status ON salary_payments(status);

CREATE INDEX IF NOT EXISTS idx_salary_advances_business_id ON salary_advances(business_id);
CREATE INDEX IF NOT EXISTS idx_salary_advances_employee_id ON salary_advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_advances_status ON salary_advances(status);

CREATE INDEX IF NOT EXISTS idx_advance_recoveries_advance_id ON advance_recoveries(advance_id);
CREATE INDEX IF NOT EXISTS idx_advance_recoveries_salary_payment_id ON advance_recoveries(salary_payment_id);

CREATE INDEX IF NOT EXISTS idx_payslips_salary_payment_id ON payslips(salary_payment_id);
CREATE INDEX IF NOT EXISTS idx_payslips_employee_id ON payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_payslips_business_id ON payslips(business_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_salary_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_salary_structures_updated_at
    BEFORE UPDATE ON salary_structures
    FOR EACH ROW
    EXECUTE FUNCTION update_salary_updated_at();

CREATE TRIGGER update_salary_payments_updated_at
    BEFORE UPDATE ON salary_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_salary_updated_at();

CREATE TRIGGER update_salary_advances_updated_at
    BEFORE UPDATE ON salary_advances
    FOR EACH ROW
    EXECUTE FUNCTION update_salary_updated_at();

-- Function to calculate remaining advance amount
CREATE OR REPLACE FUNCTION calculate_advance_remaining(p_advance_id UUID)
RETURNS DECIMAL(12,2) AS $$
DECLARE
    v_advance_amount DECIMAL(12,2);
    v_recovered_amount DECIMAL(12,2);
BEGIN
    SELECT advance_amount, COALESCE(recovered_amount, 0) INTO v_advance_amount, v_recovered_amount
    FROM salary_advances
    WHERE id = p_advance_id;
    
    IF v_advance_amount IS NULL THEN
        RETURN 0;
    END IF;
    
    RETURN v_advance_amount - v_recovered_amount;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE salary_structures IS 'Defines salary components and structure for employees';
COMMENT ON TABLE salary_payments IS 'Records of actual salary payments made to employees';
COMMENT ON TABLE salary_advances IS 'Salary advances given to employees before salary due date';
COMMENT ON TABLE advance_recoveries IS 'Tracks recovery of advances from salary payments';
COMMENT ON TABLE payslips IS 'Generated payslip documents for employees';

