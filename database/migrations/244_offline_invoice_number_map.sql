-- Migration 244: Offline temporary invoice number → final legal number mapping (Phase 3c)

CREATE TABLE IF NOT EXISTS offline_invoice_number_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  offline_reference_number TEXT NOT NULL,
  final_invoice_number TEXT NOT NULL,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  replay_log_id UUID NULL REFERENCES offline_replay_log(id) ON DELETE SET NULL,
  device_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_invoice_map_business_offline_ref
  ON offline_invoice_number_map (business_id, offline_reference_number);

CREATE INDEX IF NOT EXISTS idx_offline_invoice_map_invoice_id
  ON offline_invoice_number_map (invoice_id);

CREATE INDEX IF NOT EXISTS idx_offline_invoice_map_replay_log
  ON offline_invoice_number_map (replay_log_id)
  WHERE replay_log_id IS NOT NULL;

COMMENT ON TABLE offline_invoice_number_map IS
  'Permanent audit trail: offline TMP invoice numbers mapped to server-assigned legal numbers';

GRANT SELECT, INSERT, UPDATE ON TABLE offline_invoice_number_map TO PUBLIC;
