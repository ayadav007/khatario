# Export Settings Addition Progress

## Status: IN PROGRESS

### Templates Completed ✅
1. ✅ **modern** - All 17 export settings added
2. ✅ **classic** - All 17 export settings added  
3. ✅ **gst_standard** - All 17 export settings added

### Templates Remaining
4. ⏳ **business_pro** - In progress
5. ⏳ **minimal** - Pending
6. ⏳ **elegant** - Pending

## Export Settings Added (17 total)

### Business Info (2)
- `show_business_iec` - IEC Code (after show_business_cin)
- `show_business_swift` - SWIFT Code (after show_business_iec)

### Invoice Metadata (2)
- `show_invoice_currency` - Invoice Currency (in invoice info section)
- `show_exchange_rate` - Exchange Rate (in invoice info section)

### Customer Info (2)
- `show_customer_country` - Customer Country (in customer section)
- `show_buyer_tax_id` - Buyer Tax ID (in customer section)

### Bank Details (1)
- `show_swift_code` - SWIFT Code in bank details (after show_branch_name)

### Export Shipping Details (8)
- `show_country_of_origin` - Country of Origin
- `show_port_of_loading` - Port of Loading
- `show_port_of_discharge` - Port of Discharge
- `show_place_of_delivery` - Place of Delivery
- `show_incoterms` - Incoterms
- `show_transport_mode` - Transport Mode
- `show_awb_number` - AWB Number
- `show_bl_number` - BL Number

### Export Declarations (2)
- `show_export_declaration` - Export Declaration (in footer)
- `show_lut_declaration` - LUT Declaration (in footer)

## Implementation Pattern

All export settings are wrapped in `{{#if invoice.is_export}}` to only show for export invoices:

```handlebars
{{#if invoice.is_export}}
  {{#ifSetting 'show_business_iec'}}
    {{#if business.iec_code}}
      <div>IEC Code: {{business.iec_code}}</div>
    {{/if}}
  {{/ifSetting}}
{{/if}}
```

## Next Steps
1. Add export settings to business_pro template
2. Add export settings to minimal template
3. Add export settings to elegant template
4. Test all export settings end-to-end

