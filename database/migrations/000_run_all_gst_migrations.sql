-- GST Compliance Migrations - Master Script
-- Run this script to apply all GST compliance migrations in order
-- 
-- IMPORTANT: Backup your database before running migrations!
-- 
-- This script consolidates all Phase 1, Phase 2, and Phase 3 migrations

-- ============================================================================
-- PHASE 1: Critical (GSTR-1 Generation)
-- ============================================================================

-- 1. Add line-item GST breakdown to invoice_items
\i database/migrations/001_phase1_invoice_items_gst_breakdown.sql

-- 2. Add document type classification to invoices
\i database/migrations/002_phase1_invoice_document_type.sql

-- 3. Add state codes to customers/suppliers
\i database/migrations/003_phase1_customer_supplier_state_code.sql

-- 4. Enhance credit_notes with GST fields
\i database/migrations/004_phase1_credit_notes_gst_fields.sql

-- 5. Create debit_notes table
\i database/migrations/005_phase1_debit_notes_table.sql

-- ============================================================================
-- PHASE 2: Important (GSTR-2 Generation)
-- ============================================================================

-- 6. Enhance purchases table with GST fields
\i database/migrations/006_phase2_purchases_gst_fields.sql

-- 7. Enhance purchase_items with GST breakdown
\i database/migrations/007_phase2_purchase_items_gst_breakdown.sql

-- ============================================================================
-- PHASE 3: Complete (Full Compliance)
-- ============================================================================

-- 8. Create advance_payments table
\i database/migrations/008_phase3_advance_payments_table.sql

-- 9. Create ITC reversals table
\i database/migrations/009_phase3_itc_reversals_table.sql

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Run schema verification query to check all fields are present
-- \i database/schema_verification_query.sql

-- Migration complete!
SELECT 'GST Compliance migrations completed successfully!' as status;

