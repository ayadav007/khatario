-- Company registration numbers and their certificates.
-- Numbers stay on businesses so a login can show them.
-- Certificate bytes stay off that row: auth loads businesses with SELECT *.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS udyam_number VARCHAR(19);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS tan VARCHAR(10);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS din VARCHAR(8);

COMMENT ON COLUMN businesses.udyam_number IS 'Udyam registration number, UDYAM-XX-00-0000000';
COMMENT ON COLUMN businesses.tan IS 'Tax deduction account number, 10 characters';
COMMENT ON COLUMN businesses.din IS 'Director identification number of the signing director, 8 digits';

CREATE TABLE IF NOT EXISTS business_registration_documents (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('msme', 'tan', 'din')),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_bytes BYTEA NOT NULL,
  uploaded_by UUID,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, kind)
);
