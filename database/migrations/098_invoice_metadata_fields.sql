-- Migration 098: Add Invoice Metadata Fields for GST Detailed Template
-- Purpose: Add delivery_note, payment_terms, other_references, dispatched_through, destination, terms_of_delivery

-- Add new fields to invoices table
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS delivery_note VARCHAR(255),
ADD COLUMN IF NOT EXISTS payment_terms TEXT,
ADD COLUMN IF NOT EXISTS other_references VARCHAR(255),
ADD COLUMN IF NOT EXISTS dispatched_through VARCHAR(255),
ADD COLUMN IF NOT EXISTS destination VARCHAR(255),
ADD COLUMN IF NOT EXISTS terms_of_delivery TEXT;

-- Add comments
COMMENT ON COLUMN invoices.delivery_note IS 'Delivery note number';
COMMENT ON COLUMN invoices.payment_terms IS 'Mode/Terms of Payment';
COMMENT ON COLUMN invoices.other_references IS 'Other references for the invoice';
COMMENT ON COLUMN invoices.dispatched_through IS 'Dispatched through information';
COMMENT ON COLUMN invoices.destination IS 'Destination address';
COMMENT ON COLUMN invoices.terms_of_delivery IS 'Terms of delivery';
