# Template Settings Audit Report

## Summary

**Total Settings Defined:** 67  
**Templates Audited:** 8

### Coverage by Template

| Template | Found | Missing | Coverage |
|----------|-------|---------|----------|
| **gst_standard** | 46 | 21 | 69% ✅ |
| **classic** | 39 | 28 | 58% ⚠️ |
| **business_pro** | 31 | 36 | 46% ⚠️ |
| **elegant** | 0 | 67 | 0% ❌ |
| **minimal** | 0 | 67 | 0% ❌ |
| **modern** | 1 | 66 | 1% ❌ |
| **thermal_80mm** | 1 | 66 | 1% ❌ |
| **thermal_58mm** | 1 | 66 | 1% ❌ |

## Critical Missing Settings

### ❌ CESS Tax - MISSING FROM ALL TEMPLATES
**Status:** Not implemented in ANY template  
**Impact:** HIGH - CESS is a required tax component for certain goods in India

### Missing by Category

#### 1. Header & Business Info (9 settings)
- `show_business_website` - Missing in most templates
- `show_business_pan` - Missing in all templates
- `show_business_cin` - Missing in all templates

#### 2. Invoice Metadata (9 settings)
Commonly missing:
- `show_invoice_type` - Missing in all templates
- `show_po_number` - Missing in all templates
- `show_reference_number` - Missing in all templates
- `show_place_of_supply` - Missing in all templates
- `show_reverse_charge` - Missing in all templates
- `show_eway_bill_number` - Missing in all templates

#### 3. Party Information (11 settings)
Commonly missing:
- `show_ship_to` - Missing in business_pro, classic
- `show_customer_email` - Missing in most templates
- `show_customer_state` - Missing in all templates
- `show_customer_state_code` - Missing in all templates
- `show_customer_pan` - Missing in all templates
- `show_contact_person` - Missing in all templates

#### 4. Items Table Columns (14 settings)
Commonly missing:
- `show_discount_percent` - Missing in most templates
- `show_item_image` - Missing in all templates
- `show_batch_number` - Missing in all templates
- `show_expiry_date` - Missing in all templates

#### 5. Summary/Totals (13 settings)
**CRITICAL MISSING:**
- `show_cess` - **MISSING FROM ALL TEMPLATES** ⚠️

Also missing in some:
- `show_cgst` / `show_sgst` / `show_igst` - Missing in business_pro, classic
- `show_additional_charges` - Missing in classic
- `show_round_off` - Missing in business_pro, classic
- `show_paid_amount` / `show_balance_amount` - Missing in business_pro

#### 6. Footer (11 settings)
Commonly missing:
- `show_bank_details` granular controls - Missing in most templates
- `show_payment_terms` - Missing in all templates
- `show_qr_code` - Missing in all templates

## Priority Fixes Required

### HIGH PRIORITY (GST Compliance)
1. ✅ **CESS Tax** - Add to ALL templates
2. ✅ **CGST/SGST/IGST** - Add to business_pro, classic
3. ✅ **Place of Supply** - Add to all templates
4. ✅ **Reverse Charge** - Add to all templates
5. ✅ **E-way Bill Number** - Add to all templates

### MEDIUM PRIORITY (Business Features)
1. ✅ **PO Number** - Add to all templates
2. ✅ **Reference Number** - Add to all templates
3. ✅ **Additional Charges** - Add to classic
4. ✅ **Round Off** - Add to business_pro, classic
5. ✅ **Paid/Balance Amount** - Add to business_pro

### LOW PRIORITY (Nice to Have)
1. Item images in table
2. Batch number, expiry date
3. QR code support
4. Customer PAN/CIN

## Template Status

### ✅ Fully Updated
- None (gst_standard is closest at 69%)

### ⚠️ Partially Updated  
- **gst_standard** (69% coverage) - Missing CESS, invoice metadata, some party info
- **classic** (58% coverage) - Missing CESS, CGST/SGST/IGST, invoice metadata
- **business_pro** (46% coverage) - Missing CESS, CGST/SGST/IGST, invoice metadata

### ❌ Not Updated
- **modern** - Needs complete rewrite
- **elegant** - Needs complete rewrite  
- **minimal** - Needs complete rewrite
- **thermal_80mm** - Needs complete rewrite
- **thermal_58mm** - Needs complete rewrite

## Recommended Action Plan

1. **Phase 1 (Critical):** Add CESS + CGST/SGST/IGST to gst_standard, classic, business_pro
2. **Phase 2 (High Priority):** Add missing invoice metadata (PO, Reference, Place of Supply, etc.)
3. **Phase 3 (Medium Priority):** Add missing party info and footer settings
4. **Phase 4 (Complete):** Update remaining templates (modern, elegant, minimal, thermal)

## Settings Placement Guidelines

### CESS Tax Placement
Should appear in totals section, after IGST/CGST/SGST:
```
Subtotal
Discount
Additional Charges
CGST (if intra-state)
SGST (if intra-state)  
IGST (if inter-state)
CESS  ← ADD HERE
Tax Total
Round Off
Grand Total
```

### Invoice Metadata Placement
Should appear in invoice details section (top right):
```
Invoice Details:
No: INV-001
Date: 2024-03-20
Type: Tax Invoice  ← ADD
PO Number: PO-123  ← ADD
Reference: REF-456 ← ADD
Place of Supply: Maharashtra (27) ← ADD
Reverse Charge: Yes ← ADD (if applicable)
E-way Bill: EWB-789 ← ADD
Due: 2024-03-27
```

### Party Information Placement
- **Ship To:** Should appear next to "Bill To" section
- **Customer Email/State/PAN:** Should appear in Bill To section when enabled
- **Contact Person:** Should appear in Bill To section


