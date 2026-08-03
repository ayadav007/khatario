-- Migration 268: Default shift per employee (Phase 2 attendance)

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS default_shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_default_shift ON employees(default_shift_id);

COMMENT ON COLUMN employees.default_shift_id IS
  'Default shift for attendance check-in and late detection when not overridden';
