-- Minimal ledger schema as left by migrations 064, 121, 123 and 126 (only the columns,
-- FKs and triggers the ledger delete guard interacts with).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE TABLE businesses (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), name TEXT);
CREATE TABLE branches (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), business_id UUID REFERENCES businesses(id) ON DELETE CASCADE);
CREATE TABLE users (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), business_id UUID REFERENCES businesses(id) ON DELETE CASCADE);
CREATE TABLE accounts (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), business_id UUID REFERENCES businesses(id) ON DELETE CASCADE);
CREATE TABLE ledger_entry_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  voucher_id UUID,
  voucher_type VARCHAR(50) NOT NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  entry_date DATE NOT NULL,
  debit DECIMAL(15,2) DEFAULT 0,
  credit DECIMAL(15,2) DEFAULT 0,
  narration TEXT,
  reference_number VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  is_editable BOOLEAN DEFAULT false,
  updated_at TIMESTAMP,
  CONSTRAINT check_debit_credit CHECK ((debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0))
);
CREATE OR REPLACE FUNCTION prevent_ledger_entry_update() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_editable = false THEN
    RAISE EXCEPTION 'Ledger entry is immutable. Entry ID: %. Use reversal entries instead of direct edits.', OLD.id;
  END IF;
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER prevent_ledger_entry_update_trigger BEFORE UPDATE ON ledger_entry_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_update();
CREATE TABLE period_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  period_start DATE NOT NULL, period_end DATE NOT NULL, is_locked BOOLEAN DEFAULT true
);
CREATE OR REPLACE FUNCTION is_period_locked(p_business_id UUID, p_branch_id UUID, p_entry_date DATE)
RETURNS BOOLEAN AS $$
DECLARE v_locked BOOLEAN := false;
BEGIN
  SELECT EXISTS(SELECT 1 FROM period_locks WHERE business_id = p_business_id AND branch_id = p_branch_id
    AND p_entry_date BETWEEN period_start AND period_end AND is_locked = true) INTO v_locked;
  IF NOT v_locked THEN
    SELECT EXISTS(SELECT 1 FROM period_locks WHERE business_id = p_business_id AND branch_id IS NULL
      AND p_entry_date BETWEEN period_start AND period_end AND is_locked = true) INTO v_locked;
  END IF;
  RETURN v_locked;
END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION validate_period_lock() RETURNS TRIGGER AS $$
BEGIN
  IF is_period_locked(NEW.business_id, NEW.branch_id, NEW.entry_date) THEN
    RAISE EXCEPTION 'Cannot create ledger entry in locked period';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER validate_period_lock_trigger BEFORE INSERT ON ledger_entry_lines
  FOR EACH ROW EXECUTE FUNCTION validate_period_lock();
CREATE TABLE ledger_entry_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ledger_entry_line_id UUID NOT NULL REFERENCES ledger_entry_lines(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  action_by UUID REFERENCES users(id) ON DELETE SET NULL,
  old_value JSONB, new_value JSONB, reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE OR REPLACE FUNCTION log_ledger_entry_creation() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ledger_entry_history (ledger_entry_line_id, action, action_by, new_value)
  VALUES (NEW.id, 'created', NULL, jsonb_build_object('voucher_id', NEW.voucher_id, 'debit', NEW.debit, 'credit', NEW.credit));
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER log_ledger_entry_creation_trigger AFTER INSERT ON ledger_entry_lines
  FOR EACH ROW EXECUTE FUNCTION log_ledger_entry_creation();
