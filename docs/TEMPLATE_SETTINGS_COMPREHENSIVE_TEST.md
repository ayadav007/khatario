# Comprehensive Template Settings End-to-End Test

## Overview
This document provides a complete testing guide for all 110 template settings across all main invoice templates.

## Test Templates
- modern
- classic
- gst_standard
- business_pro
- minimal
- elegant

## Total Settings: 110

### Settings Breakdown by Category

#### 1. Header & Business Info (11 settings)
- `show_logo` ✅
- `show_business_name` ✅
- `show_business_address` ✅
- `show_business_phone` ✅
- `show_business_email` ✅
- `show_business_website` ✅
- `show_business_gstin` ✅
- `show_business_pan` ✅
- `show_business_cin` ✅
- `show_business_iec` ⚠️ (Export only - needs to be added)
- `show_business_swift` ⚠️ (Export only - needs to be added)

#### 2. Invoice Metadata (11 settings)
- `show_invoice_number` ✅
- `show_invoice_date` ✅
- `show_invoice_type` ✅
- `show_due_date` ✅
- `show_po_number` ✅
- `show_reference_number` ✅
- `show_place_of_supply` ✅
- `show_reverse_charge` ✅
- `show_eway_bill_number` ✅
- `show_invoice_currency` ⚠️ (Export only - needs to be added)
- `show_exchange_rate` ⚠️ (Export only - needs to be added)

#### 3. Party Information (14 settings)
- `show_bill_to` ✅
- `show_ship_to` ✅
- `show_customer_name` ✅
- `show_customer_address` ✅
- `show_customer_phone` ✅
- `show_customer_email` ✅
- `show_customer_gstin` ✅
- `show_customer_state` ✅
- `show_customer_state_code` ✅
- `show_customer_pan` ✅
- `show_contact_person` ✅
- `show_customer_country` ⚠️ (Export only - needs to be added)
- `show_buyer_tax_id` ⚠️ (Export only - needs to be added)

#### 4. Items Table Columns (14 settings)
- `show_serial_number` ✅
- `show_item_name` ✅
- `show_hsn` ✅
- `show_unit` ✅
- `show_quantity` ✅
- `show_rate` ✅
- `show_discount_percent` ✅
- `show_discount_amount` ✅
- `show_tax_rate` ✅
- `show_tax_amount` ✅
- `show_line_total` ✅
- `show_item_image` ✅
- `show_batch_number` ✅
- `show_expiry_date` ✅

#### 5. Summary/Totals (13 settings)
- `show_subtotal` ✅
- `show_discount_total` ✅
- `show_additional_charges` ✅
- `show_cgst` ✅
- `show_sgst` ✅
- `show_igst` ✅
- `show_cess` ✅
- `show_tax_total` ✅
- `show_round_off` ✅
- `show_grand_total` ✅
- `show_amount_in_words` ✅
- `show_paid_amount` ✅
- `show_balance_amount` ✅

#### 6. Footer (11 settings)
- `show_bank_details` ✅
- `show_bank_name` ✅
- `show_account_number` ✅
- `show_ifsc_code` ✅
- `show_branch_name` ✅
- `show_swift_code` ⚠️ (Export only - needs to be added)
- `show_payment_terms` ✅
- `show_terms` ✅
- `show_notes` ✅
- `show_signature` ✅
- `show_authorized_signatory` ✅
- `show_qr_code` ✅

#### 7. Export-Specific Fields (12 settings)
- `show_country_of_origin` ⚠️ (Needs to be added)
- `show_port_of_loading` ⚠️ (Needs to be added)
- `show_port_of_discharge` ⚠️ (Needs to be added)
- `show_place_of_delivery` ⚠️ (Needs to be added)
- `show_incoterms` ⚠️ (Needs to be added)
- `show_transport_mode` ⚠️ (Needs to be added)
- `show_awb_number` ⚠️ (Needs to be added)
- `show_bl_number` ⚠️ (Needs to be added)
- `show_export_declaration` ⚠️ (Needs to be added)
- `show_lut_declaration` ⚠️ (Needs to be added)

#### 8. Appearance (10 settings)
- `primary_color` ✅
- `text_color` ⚠️ (Missing in some templates)
- `table_header_color` ⚠️ (Missing in some templates)
- `font_size` ✅
- `font_family` ✅
- `page_size` ✅
- `orientation` ✅
- `margin_top` ✅
- `margin_bottom` ✅
- `margin_left` ✅
- `margin_right` ✅

#### 9. Content (4 settings)
- `terms` ✅
- `payment_terms` ✅
- `notes` ✅
- `footer_text` ✅

## Test Procedure

### For Each Template:

#### Step 1: Save Settings
1. Navigate to Settings → Templates → Customize [template]
2. Test each category:
   - Change colors (primary_color, text_color, table_header_color)
   - Change fonts (font_family, font_size)
   - Change margins (margin_top, margin_bottom, margin_left, margin_right)
   - Toggle all show_* settings
   - Change content (terms, notes, footer_text)
3. Click "Save"
4. Verify in database: `SELECT * FROM business_template_assignments WHERE template_id = '[template]'`

#### Step 2: Preview Test
1. Create a new invoice
2. Click "Preview"
3. Verify:
   - Colors are applied correctly
   - Fonts are applied correctly
   - Margins are applied correctly
   - All enabled show_* fields are visible
   - All disabled show_* fields are hidden
   - Content (terms, notes) is displayed correctly

#### Step 3: PDF Test
1. Generate PDF of the invoice
2. Open PDF
3. Verify same as Step 2

#### Step 4: Settings Retrieval Test
1. Check browser console for template selection logs
2. Verify settings are fetched from database
3. Verify settings are merged with defaults correctly
4. Verify template-specific defaults are applied

## Missing Settings to Add

### Export-Specific Settings (for all templates)
These should be added to all templates but will only show when `invoice.is_export = true`:

1. `show_business_iec` - IEC Code
2. `show_business_swift` - SWIFT Code
3. `show_invoice_currency` - Invoice Currency
4. `show_exchange_rate` - Exchange Rate
5. `show_customer_country` - Customer Country
6. `show_buyer_tax_id` - Buyer Tax ID
7. `show_swift_code` - SWIFT Code in bank details
8. `show_country_of_origin` - Country of Origin
9. `show_port_of_loading` - Port of Loading
10. `show_port_of_discharge` - Port of Discharge
11. `show_place_of_delivery` - Place of Delivery
12. `show_incoterms` - Incoterms
13. `show_transport_mode` - Transport Mode
14. `show_awb_number` - AWB Number
15. `show_bl_number` - BL Number
16. `show_export_declaration` - Export Declaration
17. `show_lut_declaration` - LUT Declaration

### Appearance Settings (for some templates)
1. `text_color` - Missing in: elegant, minimal, business_pro
2. `table_header_color` - Missing in: elegant, minimal, business_pro

## Test Results Tracking

Create a spreadsheet or document tracking:
- Template name
- Setting name
- Status (✅ Working / ❌ Not Working / ⚠️ Needs Fix)
- Notes

## Automated Testing

The test script `scripts/test-all-template-settings.js` can be run to check:
- Which settings are found in each template
- Which settings are missing
- Coverage percentage per template

Run: `node scripts/test-all-template-settings.js`

