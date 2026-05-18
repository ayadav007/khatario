-- =====================================================
-- LIMITS REGISTRY SYSTEM MIGRATION
-- Migration: 013_limits_registry_system.sql
-- Date: 2024
-- Description: Create Limits Registry tables and migrate existing limits
-- =====================================================

-- 1. Create platform_limits table (Limits Registry)
CREATE TABLE IF NOT EXISTS platform_limits (
  limit_key VARCHAR(100) PRIMARY KEY,           -- 'max_invoices_per_month'
  category VARCHAR(50) NOT NULL,                -- 'sales', 'purchase', 'hr', 'general', 'integrations'
  label VARCHAR(100) NOT NULL,                  -- 'Max Invoices Per Month'
  description TEXT,                             -- 'Maximum number of invoices that can be created per month'
  unit VARCHAR(50),                             -- 'per month', 'total', 'per day', 'per employee'
  default_value INTEGER DEFAULT 0,              -- Default limit value
  min_value INTEGER DEFAULT -1,                 -- Minimum allowed (-1 = unlimited)
  max_value INTEGER DEFAULT NULL,               -- Maximum allowed (NULL = no cap)
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create subscription_plan_limits mapping table
CREATE TABLE IF NOT EXISTS subscription_plan_limits (
  plan_id VARCHAR(50) NOT NULL,
  limit_key VARCHAR(100) NOT NULL,
  limit_value INTEGER NOT NULL,                 -- -1 means unlimited
  PRIMARY KEY (plan_id, limit_key),
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (limit_key) REFERENCES platform_limits(limit_key) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_plan_limits_plan ON subscription_plan_limits(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_limits_key ON subscription_plan_limits(limit_key);
CREATE INDEX IF NOT EXISTS idx_platform_limits_category ON platform_limits(category, sort_order);
CREATE INDEX IF NOT EXISTS idx_platform_limits_active ON platform_limits(is_active, category);

-- =====================================================
-- POPULATE PLATFORM LIMITS
-- =====================================================

INSERT INTO platform_limits (limit_key, category, label, description, unit, default_value, sort_order) VALUES
-- SALES LIMITS
('max_invoices_per_month', 'sales', 'Max Invoices Per Month', 'Maximum number of invoices that can be created per month', 'per month', 20, 1),
('max_customers', 'sales', 'Max Customers', 'Maximum number of customers', 'total', 10, 2),
('max_items', 'sales', 'Max Items', 'Maximum number of items/products', 'total', 10, 3),
('max_estimates_per_month', 'sales', 'Max Estimates Per Month', 'Maximum number of estimates/quotations per month', 'per month', 10, 4),
('max_credit_notes_per_month', 'sales', 'Max Credit Notes Per Month', 'Maximum number of credit notes per month', 'per month', 10, 5),
('max_sales_orders_per_month', 'sales', 'Max Sales Orders Per Month', 'Maximum number of sales orders per month', 'per month', 10, 6),

-- GENERAL LIMITS
('max_users', 'general', 'Max Users', 'Maximum number of system users/staff members', 'total', 1, 1),
('max_branches', 'general', 'Max Branches/Locations', 'Maximum number of business branches or locations', 'total', 1, 2),
('max_departments', 'general', 'Max Departments', 'Maximum number of departments', 'total', 5, 3),

-- INTEGRATIONS LIMITS
('max_whatsapp_per_day', 'integrations', 'Max WhatsApp Messages Per Day', 'Maximum WhatsApp messages that can be sent per day', 'per day', 0, 1),
('max_email_per_day', 'integrations', 'Max Emails Per Day', 'Maximum emails that can be sent per day', 'per day', 10, 2),

-- HR & EMPLOYEES LIMITS
('max_employees', 'hr', 'Max Employees', 'Maximum number of employees', 'total', 0, 1),
('max_attendance_records_per_month', 'hr', 'Max Attendance Records Per Month', 'Maximum attendance records per month', 'per month', 0, 2),
('max_leave_requests_per_month', 'hr', 'Max Leave Requests Per Month', 'Maximum leave requests per month (across all employees)', 'per month', 0, 3),
('max_leave_requests_per_employee_per_year', 'hr', 'Max Leave Requests Per Employee Per Year', 'Maximum leave requests per employee per year', 'per employee per year', 0, 4),
('max_payroll_records_per_month', 'hr', 'Max Payroll Records Per Month', 'Maximum payroll/payslip records per month', 'per month', 0, 5),
('max_salary_advances_per_month', 'hr', 'Max Salary Advances Per Month', 'Maximum salary advance requests per month', 'per month', 0, 6),
('max_designations', 'hr', 'Max Designations', 'Maximum number of employee designations/job titles', 'total', 10, 7),
('max_shifts', 'hr', 'Max Shifts', 'Maximum number of shift definitions', 'total', 5, 8),
('max_holidays', 'hr', 'Max Holidays', 'Maximum number of holidays/leave types configured', 'total', 10, 9),
('max_performance_reviews_per_month', 'hr', 'Max Performance Reviews Per Month', 'Maximum performance reviews per month', 'per month', 0, 10),
('max_employee_expenses_per_month', 'hr', 'Max Employee Expenses Per Month', 'Maximum employee expense claims per month', 'per month', 0, 11),
('max_commissions_per_month', 'hr', 'Max Commission Records Per Month', 'Maximum commission records per month', 'per month', 0, 12),
('max_employee_tasks_per_month', 'hr', 'Max Employee Tasks Per Month', 'Maximum tasks assigned to employees per month', 'per month', 0, 13),

-- PURCHASE LIMITS
('max_purchases_per_month', 'purchase', 'Max Purchases Per Month', 'Maximum purchase bills per month', 'per month', 10, 1),
('max_suppliers', 'purchase', 'Max Suppliers', 'Maximum number of suppliers', 'total', 10, 2),
('max_purchase_orders_per_month', 'purchase', 'Max Purchase Orders Per Month', 'Maximum purchase orders per month', 'per month', 10, 3),
('max_expenses_per_month', 'purchase', 'Max Expenses Per Month', 'Maximum expense records per month', 'per month', 20, 4)

ON CONFLICT (limit_key) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit,
  updated_at = CURRENT_TIMESTAMP;

-- =====================================================
-- MIGRATE EXISTING LIMITS FROM JSONB
-- =====================================================

-- Migrate limits from subscription_plans.features.limits JSONB to subscription_plan_limits
DO $$
DECLARE
  plan_record RECORD;
  limit_key_var TEXT;
  limit_value_var TEXT;
  mapped_limit_key TEXT;
BEGIN
  FOR plan_record IN SELECT id, features FROM subscription_plans LOOP
    IF plan_record.features->'limits' IS NOT NULL THEN
      -- Map existing limits
      FOR limit_key_var, limit_value_var IN 
        SELECT * FROM jsonb_each_text(plan_record.features->'limits')
      LOOP
        -- Map limit keys (keep same names)
        mapped_limit_key := limit_key_var;

        -- Verify limit exists in platform_limits
        IF EXISTS (SELECT 1 FROM platform_limits WHERE platform_limits.limit_key = mapped_limit_key) THEN
          INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
          VALUES (plan_record.id, mapped_limit_key, (limit_value_var::integer))
          ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = (limit_value_var::integer);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- View migration results
-- SELECT 
--   sp.id as plan_id,
--   sp.display_name,
--   COUNT(spl.limit_key) as limit_count
-- FROM subscription_plans sp
-- LEFT JOIN subscription_plan_limits spl ON sp.id = spl.plan_id
-- GROUP BY sp.id, sp.display_name
-- ORDER BY sp.sort_order;
