-- Per-user mobile bottom navigation (4 or 5 tabs). Null means the default layout for their modules.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mobile_nav JSONB;

COMMENT ON COLUMN users.mobile_nav IS 'Mobile bottom nav choice: { slotCount: 4|5, middle: shortcut ids }. Null uses the default layout.';
