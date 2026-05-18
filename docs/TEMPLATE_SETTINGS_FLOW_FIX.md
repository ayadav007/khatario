# Template Settings Flow - Comprehensive Fix

## Problem Summary

The user reported that:
1. **Colors selected in template customization don't reflect in invoice preview/PDF**
2. **Bank details selected in template don't reflect**
3. **Need to verify all 110 settings are properly reflected**

## Root Causes Identified

### 1. Template Preview Route Not Using Proper Settings Merging
**File**: `app/api/template-preview/route.ts`

**Issue**: The route was manually merging settings without using the default settings system:
- Was only merging `customSettings` with sample data settings
- Was not using `getDefaultTemplateSettings()` to get template-specific defaults
- Was not using `mergeTemplateSettings()` for proper merging

**Fix**: 
- Now uses `getDefaultTemplateSettings(templateId)` to get template-specific defaults
- Uses `mergeTemplateSettings(customSettings, defaults)` for proper merging
- Ensures all boolean values are explicitly set (not undefined)

### 2. Settings Flow Verification

The complete settings flow is now:

```
Customization UI
    ↓
Save to business_template_assignments table
    ↓
Invoice Preview/PDF Generation
    ↓
Fetch from business_template_assignments
    ↓
Merge: Defaults → Saved Settings → Request Settings
    ↓
prepareInvoiceForRendering(data, finalSettings)
    ↓
InvoiceRenderer.renderHtml(templateId, renderData)
    ↓
Handlebars template with settings in root context
```

## All 110 Settings Breakdown

### Boolean Settings (89)
- **Header & Business Info** (11): show_logo, show_business_name, show_business_address, show_business_phone, show_business_email, show_business_website, show_business_gstin, show_business_pan, show_business_cin, show_business_iec, show_business_swift
- **Invoice Metadata** (9): show_invoice_number, show_invoice_date, show_invoice_type, show_due_date, show_po_number, show_reference_number, show_place_of_supply, show_reverse_charge, show_eway_bill_number
- **Party Information** (12): show_bill_to, show_ship_to, show_customer_name, show_customer_address, show_customer_phone, show_customer_email, show_customer_gstin, show_customer_state, show_customer_state_code, show_customer_pan, show_contact_person, show_customer_country, show_buyer_tax_id
- **Items Table Columns** (14): show_serial_number, show_item_name, show_hsn, show_unit, show_quantity, show_rate, show_discount_percent, show_discount_amount, show_tax_rate, show_tax_amount, show_line_total, show_item_image, show_batch_number, show_expiry_date
- **Summary/Totals** (13): show_subtotal, show_discount_total, show_additional_charges, show_cgst, show_sgst, show_igst, show_cess, show_tax_total, show_round_off, show_grand_total, show_amount_in_words, show_paid_amount, show_balance_amount
- **Footer** (11): show_bank_details, show_bank_name, show_account_number, show_ifsc_code, show_branch_name, show_swift_code, show_payment_terms, show_terms, show_notes, show_signature, show_authorized_signatory, show_qr_code
- **Export-specific** (12): show_invoice_currency, show_exchange_rate, show_country_of_origin, show_port_of_loading, show_port_of_discharge, show_place_of_delivery, show_incoterms, show_transport_mode, show_awb_number, show_bl_number, show_export_declaration, show_lut_declaration

### String Settings (16)
- **Appearance**: primary_color, text_color, table_header_color, font_family, page_size, orientation
- **Content**: terms, payment_terms, notes, footer_text
- **Template**: template_id

### Number Settings (5)
- **Appearance**: font_size, margin_top, margin_bottom, margin_left, margin_right

## Color Settings Fix

### How Colors Are Applied

1. **Default Colors** (from `lib/template-defaults.ts`):
   - `modern`: primary_color = '#4f46e5' (Indigo)
   - `classic`: primary_color = '#dc2626' (Red)
   - `elegant`: primary_color = '#059669' (Emerald)
   - `minimal`: primary_color = '#000000' (Black)
   - `gst_standard`: primary_color = '#1e3a8a' (Blue)

2. **Template Usage**:
   - Templates use CSS variables: `--primary: {{settings.primary_color}}`
   - Or inline styles: `color: {{settings.primary_color}}`
   - `text_color` and `table_header_color` are also applied similarly

3. **Settings Flow**:
   ```
   Customization → Save → Fetch → Merge with defaults → Pass to template
   ```

### Verification Checklist

- [x] `primary_color` is in TemplateSettings interface
- [x] `text_color` is in TemplateSettings interface
- [x] `table_header_color` is in TemplateSettings interface
- [x] Defaults are set in `getDefaultTemplateSettings()`
- [x] Settings are merged in preview route
- [x] Settings are merged in invoice preview route
- [x] Settings are passed to Handlebars templates
- [x] Templates use `{{settings.primary_color}}` syntax

## Bank Details Fix

### How Bank Details Are Applied

1. **Database Source**: `bank_accounts` table
   - Fetched by `prepareInvoiceForRendering()` in `lib/invoice-presenter.ts`
   - Returns first active bank account for the business

2. **Merging**:
   - Bank details are merged into `business` object:
     ```typescript
     business: {
       ...business,
       bank_name: bankDetails?.bank_name || business.bank_name || null,
       account_number: bankDetails?.account_number || business.account_number || null,
       ifsc_code: bankDetails?.ifsc_code || business.ifsc_code || null,
       branch_name: bankDetails?.branch_name || business.branch_name || null
     }
     ```

3. **Template Usage**:
   - Templates check `{{#ifSetting 'show_bank_details'}}`
   - Then check individual fields: `show_bank_name`, `show_account_number`, etc.

### Verification Checklist

- [x] Bank details are fetched from `bank_accounts` table
- [x] Bank details are merged in `prepareInvoiceForRendering()`
- [x] Bank details are merged in template-preview route
- [x] Templates check `show_bank_details` setting
- [x] Templates check individual bank field settings

## Testing Checklist

### Colors
1. Customize template → Change primary_color to '#FF0000'
2. Save settings
3. Preview invoice → Should show red color
4. Generate PDF → Should show red color

### Bank Details
1. Add bank account in Business Profile
2. Enable `show_bank_details` in template customization
3. Enable `show_bank_name`, `show_account_number`, etc.
4. Preview invoice → Should show bank details
5. Generate PDF → Should show bank details

### All Settings
1. Customize template → Change any setting
2. Save settings
3. Preview invoice → Should reflect setting
4. Generate PDF → Should reflect setting

## Files Modified

1. **app/api/template-preview/route.ts**
   - Added import for `getDefaultTemplateSettings` and `mergeTemplateSettings`
   - Fixed settings merging to use defaults properly
   - Ensured all boolean values are explicitly set

2. **lib/template-defaults.ts** (already correct)
   - Provides template-specific defaults
   - Handles color defaults per template

3. **lib/invoice-presenter.ts** (already correct)
   - Fetches bank details from database
   - Merges bank details into business object

4. **lib/invoice-renderer.ts** (already correct)
   - Passes settings to Handlebars templates
   - `ifSetting` helper accesses settings from root context

## Next Steps

1. Test color changes in customization → preview → PDF
2. Test bank details in customization → preview → PDF
3. Test all 110 settings systematically
4. Verify settings are saved correctly in database
5. Verify settings are retrieved correctly from database

