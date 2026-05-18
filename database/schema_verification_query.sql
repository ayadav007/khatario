-- Comprehensive GST Compliance Schema Verification Query
-- Run this in pgAdmin to verify all GST-related fields are present

-- 1. Check invoice_items GST fields
SELECT 
    'invoice_items' as table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'invoice_items'
  AND column_name IN ('cgst_amount', 'sgst_amount', 'igst_amount', 'taxable_value')
ORDER BY column_name;

-- 2. Check invoices document type fields
SELECT 
    'invoices' as table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'invoices'
  AND column_name IN (
    'document_type', 'supply_type', 'export_type', 
    'shipping_bill_number', 'shipping_bill_date', 'port_code',
    'ecommerce_operator_gstin', 'is_ecommerce_supply'
  )
ORDER BY column_name;

-- 3. Check customers/suppliers state_code
SELECT 
    'customers' as table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'customers' AND column_name = 'state_code'
UNION ALL
SELECT 
    'suppliers' as table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'suppliers' AND column_name = 'state_code';

-- 4. Check credit_notes GST fields
SELECT 
    'credit_notes' as table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'credit_notes'
  AND column_name IN ('cgst_total', 'sgst_total', 'igst_total', 'place_of_supply_state_code', 'original_invoice_date')
ORDER BY column_name;

-- 5. Check if debit_notes table exists
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'debit_notes')
        THEN 'debit_notes table EXISTS'
        ELSE 'debit_notes table MISSING'
    END as debit_notes_status;

-- 6. Check purchases GST fields
SELECT 
    'purchases' as table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'purchases'
  AND column_name IN (
    'cgst_total', 'sgst_total', 'igst_total', 'place_of_supply_state_code',
    'is_reverse_charge', 'supplier_gstin', 'document_type',
    'itc_eligible', 'itc_availed', 'itc_availed_date'
  )
ORDER BY column_name;

-- 7. Check purchase_items GST fields
SELECT 
    'purchase_items' as table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'purchase_items'
  AND column_name IN (
    'hsn_sac', 'discount_percent', 'discount_amount', 'taxable_value',
    'cgst_amount', 'sgst_amount', 'igst_amount', 'tax_amount'
  )
ORDER BY column_name;

-- 8. Check if advance_payments table exists
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'advance_payments')
        THEN 'advance_payments table EXISTS'
        ELSE 'advance_payments table MISSING'
    END as advance_payments_status;

-- 9. Check if itc_reversals table exists
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'itc_reversals')
        THEN 'itc_reversals table EXISTS'
        ELSE 'itc_reversals table MISSING'
    END as itc_reversals_status;

-- 11. Check items type field
SELECT 
    'items' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'items'
  AND column_name IN ('item_type', 'selling_price', 'hsn_sac')
ORDER BY column_name;

-- 12. Summary: Count of GST-related columns per table
SELECT 
    table_name,
    COUNT(*) as gst_columns_count,
    STRING_AGG(column_name, ', ' ORDER BY column_name) as gst_columns
FROM information_schema.columns
WHERE table_name IN ('invoices', 'invoice_items', 'purchases', 'purchase_items', 'credit_notes', 'customers', 'suppliers', 'items')
  AND (
    column_name LIKE '%gst%' OR 
    column_name LIKE '%cgst%' OR 
    column_name LIKE '%sgst%' OR 
    column_name LIKE '%igst%' OR
    column_name IN ('place_of_supply_state_code', 'state_code', 'supply_type', 'document_type', 'hsn_sac', 'taxable_value', 'itc_eligible', 'item_type')
  )
GROUP BY table_name
ORDER BY table_name;

