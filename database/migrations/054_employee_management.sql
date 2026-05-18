-- Migration 054: Employee Management System
-- Creates core employee tables and extends users table

-- Employees table (extends users)
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    employee_code VARCHAR(50) NOT NULL,
    designation VARCHAR(100),
    department VARCHAR(100),
    joining_date DATE,
    reporting_manager_id UUID REFERENCES employees(id),
    employment_type VARCHAR(20) DEFAULT 'full_time', -- 'full_time', 'part_time', 'contract'
    access_type VARCHAR(20) DEFAULT 'full', -- 'full' = full portal access, 'attendance_only' = attendance-only access
    salary DECIMAL(12,2),
    photo_url TEXT,
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(20),
    bank_account_number VARCHAR(50),
    bank_ifsc VARCHAR(20),
    bank_name VARCHAR(100),
    pan_number VARCHAR(10),
    aadhaar_number VARCHAR(12),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, employee_code)
);

-- Employee documents
CREATE TABLE IF NOT EXISTS employee_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    document_type VARCHAR(50), -- 'aadhaar', 'pan', 'resume', 'contract', 'other'
    document_name VARCHAR(255),
    file_url TEXT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_employees_business_id ON employees(business_id);
CREATE INDEX IF NOT EXISTS idx_employees_employee_code ON employees(employee_code);
CREATE INDEX IF NOT EXISTS idx_employees_reporting_manager ON employees(reporting_manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_access_type ON employees(access_type);
CREATE INDEX IF NOT EXISTS idx_employees_is_active ON employees(is_active);
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_id ON employee_documents(employee_id);

-- Function to generate next employee code
CREATE OR REPLACE FUNCTION generate_employee_code(p_business_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    v_last_code VARCHAR(50);
    v_next_number INTEGER;
    v_prefix VARCHAR(10) := 'EMP';
BEGIN
    -- Get the last employee code for this business
    SELECT employee_code INTO v_last_code
    FROM employees
    WHERE business_id = p_business_id
    AND employee_code ~ '^EMP[0-9]+$'
    ORDER BY CAST(SUBSTRING(employee_code FROM 4) AS INTEGER) DESC
    LIMIT 1;
    
    -- Extract number and increment
    IF v_last_code IS NULL THEN
        v_next_number := 1;
    ELSE
        v_next_number := CAST(SUBSTRING(v_last_code FROM 4) AS INTEGER) + 1;
    END IF;
    
    -- Return formatted code (EMP001, EMP002, etc.)
    RETURN v_prefix || LPAD(v_next_number::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_employee_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_employees_updated_at
    BEFORE UPDATE ON employees
    FOR EACH ROW
    EXECUTE FUNCTION update_employee_updated_at();

COMMENT ON TABLE employees IS 'Employee records extending users table with employment details';
COMMENT ON TABLE employee_documents IS 'Documents uploaded for employees (Aadhaar, PAN, etc.)';
COMMENT ON COLUMN employees.access_type IS 'full = full portal access, attendance_only = only attendance marking';
COMMENT ON COLUMN employees.employment_type IS 'full_time, part_time, or contract employment';

