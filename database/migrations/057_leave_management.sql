-- Migration 057: Leave Management System
-- Handles leave types, balances, requests, and approval workflows

-- Leave types (configurable per business)
CREATE TABLE IF NOT EXISTS leave_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    leave_name VARCHAR(100) NOT NULL,
    leave_code VARCHAR(20) NOT NULL, -- 'CL', 'SL', 'PL', 'EL', etc.
    max_days_per_year INTEGER,
    carry_forward BOOLEAN DEFAULT false,
    max_carry_forward_days INTEGER,
    requires_approval BOOLEAN DEFAULT true,
    is_paid BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, leave_code)
);

-- Employee leave balances
CREATE TABLE IF NOT EXISTS leave_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id UUID REFERENCES leave_types(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    opening_balance DECIMAL(5,2) DEFAULT 0,
    earned_days DECIMAL(5,2) DEFAULT 0, -- Days earned during the year
    used_days DECIMAL(5,2) DEFAULT 0,
    carry_forward_days DECIMAL(5,2) DEFAULT 0,
    current_balance DECIMAL(5,2) DEFAULT 0, -- opening + earned + carry_forward - used
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, leave_type_id, year)
);

-- Leave requests
CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id UUID REFERENCES leave_types(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days DECIMAL(5,2) NOT NULL, -- Calculated excluding weekends/holidays
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'cancelled'
    requested_by UUID REFERENCES employees(id), -- Usually same as employee_id
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    rejected_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    attachment_url TEXT, -- For medical certificates, etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Leave request comments/notes (for internal communication)
CREATE TABLE IF NOT EXISTS leave_request_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    leave_request_id UUID REFERENCES leave_requests(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id), -- Who made the comment
    comment_text TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT false, -- Internal notes not visible to employee
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Holiday calendar (for calculating working days)
CREATE TABLE IF NOT EXISTS holidays (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    holiday_date DATE NOT NULL,
    holiday_name VARCHAR(255) NOT NULL,
    is_recurring BOOLEAN DEFAULT false, -- Recurring holidays (e.g., Independence Day)
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, holiday_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leave_types_business ON leave_types(business_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances(employee_id, year);
CREATE INDEX IF NOT EXISTS idx_leave_balances_type ON leave_balances(leave_type_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_request_comments_request ON leave_request_comments(leave_request_id);
CREATE INDEX IF NOT EXISTS idx_holidays_business ON holidays(business_id, holiday_date);

-- Triggers
CREATE TRIGGER update_leave_types_updated_at
    BEFORE UPDATE ON leave_types
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leave_balances_updated_at
    BEFORE UPDATE ON leave_balances
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leave_requests_updated_at
    BEFORE UPDATE ON leave_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate working days between two dates (excluding weekends and holidays)
CREATE OR REPLACE FUNCTION calculate_working_days(
    p_start_date DATE,
    p_end_date DATE,
    p_business_id UUID
)
RETURNS DECIMAL(5,2) AS $$
DECLARE
    v_count DECIMAL(5,2) := 0;
    v_current_date DATE;
    v_is_holiday BOOLEAN;
BEGIN
    v_current_date := p_start_date;
    
    WHILE v_current_date <= p_end_date LOOP
        -- Check if it's a weekend (Saturday = 6, Sunday = 0)
        IF EXTRACT(DOW FROM v_current_date) NOT IN (0, 6) THEN
            -- Check if it's a holiday
            SELECT EXISTS(
                SELECT 1 FROM holidays 
                WHERE business_id = p_business_id 
                AND holiday_date = v_current_date
            ) INTO v_is_holiday;
            
            IF NOT v_is_holiday THEN
                v_count := v_count + 1;
            END IF;
        END IF;
        
        v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-update leave balance when request is approved
CREATE OR REPLACE FUNCTION update_leave_balance_on_approval()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update when status changes to 'approved'
    IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
        UPDATE leave_balances
        SET used_days = used_days + NEW.total_days,
            current_balance = current_balance - NEW.total_days,
            updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = NEW.employee_id
        AND leave_type_id = NEW.leave_type_id
        AND year = EXTRACT(YEAR FROM NEW.start_date)::INTEGER;
    END IF;
    
    -- If status changes from 'approved' to something else, reverse the deduction
    IF OLD.status = 'approved' AND NEW.status != 'approved' THEN
        UPDATE leave_balances
        SET used_days = used_days - OLD.total_days,
            current_balance = current_balance + OLD.total_days,
            updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = OLD.employee_id
        AND leave_type_id = OLD.leave_type_id
        AND year = EXTRACT(YEAR FROM OLD.start_date)::INTEGER;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_leave_balance_trigger
    AFTER INSERT OR UPDATE ON leave_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_leave_balance_on_approval();

COMMENT ON TABLE leave_types IS 'Configurable leave types for the business';
COMMENT ON TABLE leave_balances IS 'Employee leave balances per year';
COMMENT ON TABLE leave_requests IS 'Employee leave requests with approval workflow';
COMMENT ON TABLE leave_request_comments IS 'Comments and notes on leave requests';
COMMENT ON TABLE holidays IS 'Holiday calendar for calculating working days';

