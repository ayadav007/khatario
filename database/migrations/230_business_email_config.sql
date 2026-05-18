-- Per-tenant SMTP settings for sending invoices, purchase orders, and other document emails.

CREATE TABLE IF NOT EXISTS business_email_config (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  smtp_host VARCHAR(255) NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_secure BOOLEAN NOT NULL DEFAULT false,
  smtp_user VARCHAR(255),
  encrypted_smtp_password TEXT,
  from_email VARCHAR(255) NOT NULL,
  from_name VARCHAR(255),
  reply_to_email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_email_config_enabled
  ON business_email_config (business_id) WHERE enabled = true;

COMMENT ON TABLE business_email_config IS 'SMTP credentials and sender identity per business for outbound email';
COMMENT ON COLUMN business_email_config.encrypted_smtp_password IS 'AES-256-GCM encrypted SMTP password (server-side only)';

DROP TRIGGER IF EXISTS update_business_email_config_updated_at ON business_email_config;
CREATE TRIGGER update_business_email_config_updated_at
  BEFORE UPDATE ON business_email_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
