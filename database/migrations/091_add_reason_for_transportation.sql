-- Migration: Add reason_for_transportation to delivery_challans
-- Purpose: GST Rule 55 compliance for delivery challan formatting
-- Date: 2026-01-02

-- Add reason for transportation column
ALTER TABLE delivery_challans
ADD COLUMN IF NOT EXISTS reason_for_transportation VARCHAR(50);

-- Valid values as per GST Rule 55:
-- 'supply' - Supply/Sale
-- 'export' - Export
-- 'job_work' - Job Work
-- 'skd_ckd' - SKD/CKD (Semi Knocked Down/Completely Knocked Down)
-- 'recipient_not_known' - Recipient not known
-- 'line_sales' - For own use
-- 'exhibition' - Exhibition or fairs
-- 'others' - Others

COMMENT ON COLUMN delivery_challans.reason_for_transportation 
IS 'GST Rule 55: Reason for transportation (supply, export, job_work, skd_ckd, recipient_not_known, line_sales, exhibition, others)';

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_delivery_challans_reason ON delivery_challans(reason_for_transportation);

