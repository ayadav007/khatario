-- Daily vs monthly pay, wage accruals that post to Salaries & Wages / Salary Payable,
-- and an asset head for advances given to employees.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS pay_basis VARCHAR(20) NOT NULL DEFAULT 'monthly';

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_pay_basis_check;
ALTER TABLE employees
  ADD CONSTRAINT employees_pay_basis_check CHECK (pay_basis IN ('daily', 'monthly'));

ALTER TABLE salary_advances
  ADD COLUMN IF NOT EXISTS books_posted BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS staff_wage_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_kind VARCHAR(10) NOT NULL CHECK (period_kind IN ('week', 'month')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued', 'reversed')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_wage_runs_open_period
  ON staff_wage_runs (business_id, period_kind, period_start)
  WHERE status = 'accrued';

CREATE TABLE IF NOT EXISTS staff_wage_accruals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES staff_wage_runs(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  present_days INTEGER NOT NULL DEFAULT 0,
  half_days INTEGER NOT NULL DEFAULT 0,
  absent_days INTEGER NOT NULL DEFAULT 0,
  off_days INTEGER NOT NULL DEFAULT 0,
  gross_amount NUMERIC(14, 2) NOT NULL,
  paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  UNIQUE (run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_wage_accruals_employee
  ON staff_wage_accruals (business_id, employee_id);

CREATE TABLE IF NOT EXISTS staff_wage_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  accrual_id UUID NOT NULL REFERENCES staff_wage_accruals(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_mode VARCHAR(50) NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Teach the chart seeder, then backfill every business that already has a chart.
CREATE OR REPLACE FUNCTION ensure_standard_account_heads(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
  g_ca UUID; g_fa UUID; g_cl UUID; g_ll UUID; g_cap UUID; g_oi UUID; g_dir UUID; g_ind UUID;
  g_liab UUID; g_exp UUID; g_inc UUID; g_asset UUID;
BEGIN
  SELECT id INTO g_asset FROM account_groups WHERE business_id = p_business_id AND group_code = '1000';
  SELECT id INTO g_liab  FROM account_groups WHERE business_id = p_business_id AND group_code = '2000';
  SELECT id INTO g_cap   FROM account_groups WHERE business_id = p_business_id AND group_code = '3000';
  SELECT id INTO g_inc   FROM account_groups WHERE business_id = p_business_id AND group_code = '4000';
  SELECT id INTO g_exp   FROM account_groups WHERE business_id = p_business_id AND group_code = '5000';
  IF g_asset IS NULL OR g_liab IS NULL OR g_cap IS NULL OR g_exp IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO g_ca  FROM account_groups WHERE business_id = p_business_id AND group_code = '1100';
  SELECT id INTO g_fa  FROM account_groups WHERE business_id = p_business_id AND group_code = '1200';
  SELECT id INTO g_cl  FROM account_groups WHERE business_id = p_business_id AND group_code = '2100';
  SELECT id INTO g_ll  FROM account_groups WHERE business_id = p_business_id AND group_code = '2200';
  SELECT id INTO g_oi  FROM account_groups WHERE business_id = p_business_id AND group_code = '4200';
  SELECT id INTO g_dir FROM account_groups WHERE business_id = p_business_id AND group_code = '5100';
  SELECT id INTO g_ind FROM account_groups WHERE business_id = p_business_id AND group_code = '5200';

  IF g_ll IS NULL THEN
    INSERT INTO account_groups (business_id, group_code, group_name, group_type, parent_group_id, is_system, sort_order)
    VALUES (p_business_id, '2200', 'Long-term Liabilities', 'liability', g_liab, true, 2)
    ON CONFLICT (business_id, group_code) DO NOTHING;
    SELECT id INTO g_ll FROM account_groups WHERE business_id = p_business_id AND group_code = '2200';
  END IF;

  g_ca  := COALESCE(g_ca, g_asset);
  g_fa  := COALESCE(g_fa, g_asset);
  g_cl  := COALESCE(g_cl, g_liab);
  g_oi  := COALESCE(g_oi, g_inc);
  g_dir := COALESCE(g_dir, g_exp);
  g_ind := COALESCE(g_ind, g_exp);

  INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
  VALUES
    (p_business_id, '1117', 'Advance Tax & TDS Paid',          'asset',     g_ca,  'debit',  true, 17),
    (p_business_id, '1118', 'Security Deposits',               'asset',     g_ca,  'debit',  true, 18),
    (p_business_id, '1119', 'Advance to Employees',            'asset',     g_ca,  'debit',  true, 19),
    (p_business_id, '2112', 'Bank OD / Cash Credit',           'liability', g_cl,  'credit', true, 12),
    (p_business_id, '2113', 'Salary Payable',                  'liability', g_cl,  'credit', true, 13),
    (p_business_id, '2114', 'PF Payable',                      'liability', g_cl,  'credit', true, 14),
    (p_business_id, '2115', 'ESI Payable',                     'liability', g_cl,  'credit', true, 15),
    (p_business_id, '2116', 'Professional Tax Payable',        'liability', g_cl,  'credit', true, 16),
    (p_business_id, '2117', 'TCS Payable',                     'liability', g_cl,  'credit', true, 17),
    (p_business_id, '2118', 'Suspense Account',                'liability', g_cl,  'credit', true, 18),
    (p_business_id, '2201', 'Secured Loans',                   'liability', g_ll,  'credit', true, 1),
    (p_business_id, '2202', 'Unsecured Loans',                 'liability', g_ll,  'credit', true, 2),
    (p_business_id, '3003', 'Drawings',                        'capital',   g_cap, 'debit',  true, 3),
    (p_business_id, '4205', 'Profit on Sale of Fixed Assets',  'income',    g_oi,  'credit', true, 8),
    (p_business_id, '5105', 'Freight Inward',                  'expense',   g_dir, 'debit',  true, 5),
    (p_business_id, '5106', 'Stock Loss / Written Off',        'expense',   g_dir, 'debit',  true, 6),
    (p_business_id, '5212', 'Salaries & Wages',                'expense',   g_ind, 'debit',  true, 12),
    (p_business_id, '5213', 'Rent',                            'expense',   g_ind, 'debit',  true, 13),
    (p_business_id, '5214', 'Staff Welfare',                   'expense',   g_ind, 'debit',  true, 14),
    (p_business_id, '5215', 'Travelling & Conveyance',         'expense',   g_ind, 'debit',  true, 15),
    (p_business_id, '5216', 'Legal & Professional Fees',       'expense',   g_ind, 'debit',  true, 16),
    (p_business_id, '5217', 'Bank Charges',                    'expense',   g_ind, 'debit',  true, 17),
    (p_business_id, '5218', 'Loss on Sale of Fixed Assets',    'expense',   g_ind, 'debit',  true, 18)
  ON CONFLICT (business_id, account_code) DO NOTHING;

  PERFORM ensure_gst_electronic_cash_ledger(p_business_id);
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_business_id UUID;
BEGIN
  FOR v_business_id IN SELECT id FROM businesses LOOP
    PERFORM ensure_standard_account_heads(v_business_id);
  END LOOP;
END $$;
