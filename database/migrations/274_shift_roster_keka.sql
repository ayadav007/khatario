-- Migration 274: Keka-style per-day shift roster

CREATE TABLE IF NOT EXISTS shift_roster_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  roster_date DATE NOT NULL,
  shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  is_day_off BOOLEAN NOT NULL DEFAULT false,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, employee_id, roster_date)
);

CREATE INDEX IF NOT EXISTS idx_shift_roster_business_date
  ON shift_roster_entries(business_id, roster_date);

CREATE INDEX IF NOT EXISTS idx_shift_roster_employee_date
  ON shift_roster_entries(employee_id, roster_date DESC);

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS shift_roster_settings JSONB NOT NULL DEFAULT '{
    "auto_mark_absent": true,
    "absent_grace_minutes_after_shift_start": 120
  }'::jsonb;

COMMENT ON TABLE shift_roster_entries IS
  'Per-day shift allocation (Keka roster). shift_id NULL + is_day_off=true = scheduled off.';
