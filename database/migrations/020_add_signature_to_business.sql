-- Add signature URL field to businesses table

ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS signature_url TEXT;

COMMENT ON COLUMN businesses.signature_url IS 'URL or base64 data of business owner signature for invoices';

