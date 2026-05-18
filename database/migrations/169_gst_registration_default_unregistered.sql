-- ============================================================================
-- Migration 169: Default GST registration = unregistered until GSTIN is known
-- ============================================================================
-- Problem: businesses.gst_registration_type DEFAULT 'regular' (migration 092)
-- meant every new signup looked "Regular GST" with no GSTIN — inconsistent for
-- compliance and confusing in v_business_coa_readiness / reports.
--
-- Rule: If there is no GSTIN, the business is not a normal GST taxpayer in the
-- system until they save GSTIN and choose Regular (or Composition) in profile.
-- New signups therefore default to 'unregistered'.
--
-- Backfill: rows that are still 'regular' but have no GSTIN are corrected to
-- 'unregistered'. Users who already entered a GSTIN keep 'regular'.
-- ============================================================================

ALTER TABLE businesses
  ALTER COLUMN gst_registration_type SET DEFAULT 'unregistered';

COMMENT ON COLUMN businesses.gst_registration_type IS
'GST scheme: regular | composition | unregistered. Default unregistered until profile sets GSTIN + scheme.';

-- Fix historical / signup rows: regular without a GSTIN is inconsistent
UPDATE businesses
SET gst_registration_type = 'unregistered',
    updated_at = CURRENT_TIMESTAMP
WHERE (gstin IS NULL OR TRIM(gstin) = '')
  AND gst_registration_type = 'regular';
