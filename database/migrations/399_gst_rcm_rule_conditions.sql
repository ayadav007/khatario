-- Conditions a reverse-charge notification can depend on.
-- Rows stay candidates until a catalogue version is professionally approved.
-- The purchase saver loads only status = 'approved'. An empty approved set
-- does not detect RCM.

ALTER TABLE gst_rcm_rules
  ADD COLUMN IF NOT EXISTS rule_key TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'candidate',
  ADD COLUMN IF NOT EXISTS recipient_class VARCHAR(40),
  ADD COLUMN IF NOT EXISTS turnover_min NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS turnover_max NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS sac_codes TEXT[],
  ADD COLUMN IF NOT EXISTS hsn_codes TEXT[],
  ADD COLUMN IF NOT EXISTS exclusions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE gst_rcm_rules DROP CONSTRAINT IF EXISTS gst_rcm_rules_status_check;
ALTER TABLE gst_rcm_rules
  ADD CONSTRAINT gst_rcm_rules_status_check
  CHECK (status IN ('candidate', 'approved'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_gst_rcm_rules_version_key
  ON gst_rcm_rules (catalogue_version, rule_key)
  WHERE rule_key IS NOT NULL;

COMMENT ON TABLE gst_rcm_rules IS
  'Reverse-charge catalogue. Candidate rows are not loaded. Approved rows require a signed-off notification version.';
COMMENT ON COLUMN gst_rcm_rules.status IS
  'candidate until professional sign-off. Only approved rows may warn or classify.';
COMMENT ON COLUMN gst_rcm_rules.exclusions IS
  'Notification exclusions. A matching code is not enough while an exclusion is unverified.';
