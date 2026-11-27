-- E-way bills generated through the GSP (Masters India): how each was made, the provider's
-- request id, its print link and the NIC transaction type.
ALTER TABLE eway_bills
  ADD COLUMN IF NOT EXISTS generated_via VARCHAR(10) NOT NULL DEFAULT 'manual'
    CHECK (generated_via IN ('manual', 'api', 'irn')),
  ADD COLUMN IF NOT EXISTS gsp_request_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS print_url TEXT,
  ADD COLUMN IF NOT EXISTS transaction_type SMALLINT;
