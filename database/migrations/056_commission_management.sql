-- Migration 056: Commission & Performance Management
-- Handles sales commission, employee targets, and performance tracking

-- Commission rules
CREATE TABLE IF NOT EXISTS commission_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id), -- NULL for role-based
    role_id UUID REFERENCES user_roles(id), -- NULL for employee-specific
    commission_type VARCHAR(20) NOT NULL, -- 'percentage', 'fixed', 'tiered'
    commission_value DECIMAL(10,2) NOT NULL,
    min_sale_amount DECIMAL(12,2) DEFAULT 0,
    max_commission DECIMAL(12,2), -- NULL for unlimited
    applies_to_item_category VARCHAR(100), -- NULL for all items
    applies_to_customer_type VARCHAR(50), -- NULL for all customers
    is_active BOOLEAN DEFAULT true,
    effective_from DATE,
    effective_to DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Employee targets
CREATE TABLE IF NOT EXISTS employee_targets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    target_period VARCHAR(20) NOT NULL, -- 'monthly', 'quarterly', 'yearly'
    target_year INTEGER NOT NULL,
    target_month INTEGER, -- NULL for quarterly/yearly
    target_amount DECIMAL(12,2) NOT NULL,
    target_invoices INTEGER, -- Optional: target number of invoices
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, target_period, target_year, target_month)
);

-- Commission earnings (linked to invoices)
CREATE TABLE IF NOT EXISTS commission_earnings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    sale_amount DECIMAL(12,2) NOT NULL,
    commission_rate DECIMAL(5,2) NOT NULL,
    commission_amount DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'paid', 'cancelled'
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMP,
    paid_at TIMESTAMP,
    payment_reference VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance metrics (aggregated daily/weekly/monthly)
CREATE TABLE IF NOT EXISTS employee_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    period_type VARCHAR(20) NOT NULL, -- 'daily', 'weekly', 'monthly'
    period_date DATE NOT NULL,
    total_sales DECIMAL(12,2) DEFAULT 0,
    total_invoices INTEGER DEFAULT 0,
    average_invoice_value DECIMAL(12,2) DEFAULT 0,
    new_customers INTEGER DEFAULT 0,
    repeat_customers INTEGER DEFAULT 0,
    total_commission DECIMAL(12,2) DEFAULT 0,
    target_amount DECIMAL(12,2),
    achievement_percentage DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, period_type, period_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_commission_rules_business ON commission_rules(business_id);
CREATE INDEX IF NOT EXISTS idx_commission_rules_employee ON commission_rules(employee_id);
CREATE INDEX IF NOT EXISTS idx_commission_rules_role ON commission_rules(role_id);
CREATE INDEX IF NOT EXISTS idx_commission_rules_active ON commission_rules(is_active, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_commission_earnings_employee ON commission_earnings(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_commission_earnings_invoice ON commission_earnings(invoice_id);
CREATE INDEX IF NOT EXISTS idx_commission_earnings_status ON commission_earnings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_targets_employee ON employee_targets(employee_id, target_year, target_month);
CREATE INDEX IF NOT EXISTS idx_performance_employee_period ON employee_performance(employee_id, period_type, period_date DESC);
CREATE INDEX IF NOT EXISTS idx_performance_period_date ON employee_performance(period_type, period_date DESC);

-- Trigger to update updated_at
CREATE TRIGGER update_commission_rules_updated_at
    BEFORE UPDATE ON commission_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_commission_earnings_updated_at
    BEFORE UPDATE ON commission_earnings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_targets_updated_at
    BEFORE UPDATE ON employee_targets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_performance_updated_at
    BEFORE UPDATE ON employee_performance
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE commission_rules IS 'Commission calculation rules for employees or roles';
COMMENT ON TABLE employee_targets IS 'Sales targets for employees';
COMMENT ON TABLE commission_earnings IS 'Commission earned by employees from invoices';
COMMENT ON TABLE employee_performance IS 'Aggregated performance metrics for employees';

