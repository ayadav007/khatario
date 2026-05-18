-- Migration: Add invoice status fields and GST columns
-- Run this in pgAdmin or psql if the Node.js script fails
-- This script is idempotent - safe to run multiple times

BEGIN;

-- Add is_editable if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'is_editable'
  ) THEN
    ALTER TABLE invoices ADD COLUMN is_editable BOOLEAN DEFAULT true;
  END IF;
END$$;

-- Add cancellation_details if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'cancellation_details'
  ) THEN
    ALTER TABLE invoices ADD COLUMN cancellation_details JSONB DEFAULT NULL;
  END IF;
END$$;

-- Add cgst_total if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'cgst_total'
  ) THEN
    ALTER TABLE invoices ADD COLUMN cgst_total DECIMAL(12,2) DEFAULT 0;
  END IF;
END$$;

-- Add sgst_total if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'sgst_total'
  ) THEN
    ALTER TABLE invoices ADD COLUMN sgst_total DECIMAL(12,2) DEFAULT 0;
  END IF;
END$$;

-- Add igst_total if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'igst_total'
  ) THEN
    ALTER TABLE invoices ADD COLUMN igst_total DECIMAL(12,2) DEFAULT 0;
  END IF;
END$$;

-- Update existing rows to have default values
UPDATE invoices SET is_editable = true WHERE is_editable IS NULL;
UPDATE invoices SET cgst_total = 0 WHERE cgst_total IS NULL;
UPDATE invoices SET sgst_total = 0 WHERE sgst_total IS NULL;
UPDATE invoices SET igst_total = 0 WHERE igst_total IS NULL;

-- Add/replace status check constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_invoice_status'
  ) THEN
    ALTER TABLE invoices DROP CONSTRAINT chk_invoice_status;
  END IF;
  ALTER TABLE invoices
  ADD CONSTRAINT chk_invoice_status CHECK (status IN ('draft','final','cancelled'));
END$$;

-- Add/replace payment_status check constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_invoice_payment_status'
  ) THEN
    ALTER TABLE invoices DROP CONSTRAINT chk_invoice_payment_status;
  END IF;
  ALTER TABLE invoices
  ADD CONSTRAINT chk_invoice_payment_status CHECK (payment_status IN ('unpaid','partially_paid','paid'));
END$$;

COMMIT;

-- Verify columns were added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'invoices'
  AND column_name IN ('is_editable', 'cancellation_details', 'cgst_total', 'sgst_total', 'igst_total')
ORDER BY column_name;


