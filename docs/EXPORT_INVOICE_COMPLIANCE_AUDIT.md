# EXPORT INVOICE COMPLIANCE AUDIT REPORT
**Date:** $(date)  
**Auditor Role:** Senior Indian GST & Export Compliance Auditor  
**System:** Khatario Invoicing SaaS - Export Invoice Module

---

## EXECUTIVE SUMMARY

This audit evaluates the Export Invoice implementation against Indian GST Law, IGST Act, Customs requirements, and Banking expectations for real-world export transactions.

**Overall Status:** ⚠️ **NEEDS SIGNIFICANT IMPROVEMENTS BEFORE PRODUCTION USE**

---

## 1. ✅ COMPLIANT AREAS

### A. Export Classification
- ✅ **Inter-State Supply Treatment**: Correctly treats exports as inter-state supply
- ✅ **CGST/SGST Prevention**: System correctly prevents CGST/SGST application for export invoices
- ✅ **IGST Logic**: IGST field present and functional
- ⚠️ **LUT Implementation**: Export type field exists (`wop`/`wp`) but IGST rate not automatically set to 0% for LUT exports

### B. Item Line Details
- ✅ **HSN/SAC Code**: Present and mandatory
- ✅ **Quantity & Unit**: Properly captured
- ✅ **Unit Price**: Correctly displayed
- ✅ **Taxable Value**: Calculated (after discount, before tax)
- ✅ **IGST Rate & Amount**: Shown in items table
- ✅ **Line Total**: Correctly calculated

### C. Tax Section
- ✅ **IGST Field**: Present and functional
- ✅ **CGST/SGST Hidden**: Correctly disabled/hidden for export invoices
- ✅ **Tax Calculation**: IGST correctly applied based on export type

### D. Basic Export Fields
- ✅ **Export Type**: Field exists (`wop` = without payment, `wp` = with payment)
- ✅ **Port Code**: Field present
- ✅ **Shipping Bill Number**: Field present
- ✅ **Shipping Bill Date**: Field present
- ✅ **Place of Supply**: Set to '96' (export) for export invoices

---

## 2. ⚠️ ISSUES / GAPS FOUND

### A. Exporter (Seller) Details - CRITICAL GAPS

#### ❌ **MISSING: IEC (Import Export Code) - MANDATORY**
- **Status**: NOT IMPLEMENTED
- **Impact**: **CRITICAL** - IEC is mandatory for all exporters in India
- **Required Action**: 
  - Add `iec_code` field to `businesses` table
  - Add IEC input field in business settings
  - Display IEC in export invoice template
  - Make IEC mandatory when creating export invoices

#### ⚠️ **PARTIAL: Business Address**
- **Status**: Present but missing "Country: India" explicitly
- **Impact**: Medium - Customs may require explicit country mention
- **Required Action**: Ensure template shows "India" in business address

#### ✅ **Present**: GSTIN, PAN, Business Name, Address, Contact Details

---

### B. Buyer (Importer) Details - CRITICAL GAPS

#### ❌ **MISSING: Country of Destination - MANDATORY**
- **Status**: NOT IMPLEMENTED
- **Impact**: **CRITICAL** - Required for customs clearance
- **Required Action**:
  - Add `country` field to `customers` table (if not exists)
  - Add country selector in customer form
  - Display country in export invoice template
  - Make country mandatory for export invoice customers

#### ❌ **MISSING: Buyer Tax/VAT ID**
- **Status**: NOT IMPLEMENTED
- **Impact**: Medium - Some countries require buyer tax ID
- **Required Action**: Add `buyer_tax_id` or `buyer_vat_id` field to invoices table

#### ⚠️ **ISSUE: GSTIN Field for Foreign Buyers**
- **Status**: Currently shows GSTIN field even for foreign buyers
- **Impact**: Medium - Foreign buyers don't have GSTIN
- **Required Action**: Hide GSTIN field for export invoices or make it optional

---

### C. Invoice Metadata - PARTIAL COMPLIANCE

#### ✅ **Present**: Invoice Number, Invoice Date, Invoice Type ("EXPORT INVOICE" banner)

#### ⚠️ **MISSING: Commercial Invoice vs Tax Invoice**
- **Status**: Template shows "TAX INVOICE" + "EXPORT INVOICE" banner
- **Impact**: Low - Some prefer "Commercial Invoice" for exports
- **Required Action**: Add option to show "Commercial Invoice" instead of "Tax Invoice"

---

### D. Shipping & Export Details - MAJOR GAPS

#### ❌ **MISSING: Country of Origin**
- **Status**: NOT IMPLEMENTED
- **Impact**: **HIGH** - Required for customs
- **Required Action**: Add `country_of_origin` field (default: "India")

#### ❌ **MISSING: Country of Final Destination**
- **Status**: NOT IMPLEMENTED (partially covered by customer country)
- **Impact**: **HIGH** - Required for customs
- **Required Action**: Ensure customer country is displayed prominently

#### ❌ **MISSING: Port of Loading**
- **Status**: NOT IMPLEMENTED
- **Impact**: **HIGH** - Required for shipping documentation
- **Required Action**: Add `port_of_loading` field to invoices table

#### ❌ **MISSING: Port of Discharge**
- **Status**: NOT IMPLEMENTED
- **Impact**: **HIGH** - Required for shipping documentation
- **Required Action**: Add `port_of_discharge` field to invoices table

#### ❌ **MISSING: Place of Delivery**
- **Status**: NOT IMPLEMENTED
- **Impact**: Medium - Required for some shipping terms
- **Required Action**: Add `place_of_delivery` field

#### ⚠️ **PARTIAL: Mode of Transport**
- **Status**: Field exists (`transport_mode`) but not in export invoice form
- **Impact**: Medium - Required for customs
- **Required Action**: Add transport mode selector in export invoice form

#### ❌ **MISSING: Incoterms**
- **Status**: NOT IMPLEMENTED
- **Impact**: **HIGH** - Critical for international trade
- **Required Action**: Add `incoterms` field (EXW, FOB, CIF, DDP, etc.)

#### ⚠️ **PARTIAL: Shipping Bill Details**
- **Status**: Fields exist but optional
- **Impact**: Low - Usually available after invoice creation
- **Note**: Current implementation is acceptable (optional at invoice stage)

#### ❌ **MISSING: AWB / BL Number**
- **Status**: NOT IMPLEMENTED
- **Impact**: Medium - Required for tracking
- **Required Action**: Add `awb_number` and `bl_number` fields

---

### E. Currency & Value Handling - MAJOR GAPS

#### ❌ **MISSING: Per-Invoice Currency Selection**
- **Status**: Business has default currency, but invoice-level currency not supported
- **Impact**: **HIGH** - Export invoices often in USD/EUR/GBP
- **Required Action**:
  - Add `invoice_currency` field to invoices table
  - Add currency selector in export invoice form
  - Display currency symbol in template

#### ❌ **MISSING: Exchange Rate Handling**
- **Status**: NOT IMPLEMENTED
- **Impact**: Medium - Required for GST calculation in INR
- **Required Action**: Add `exchange_rate` and `base_currency_amount` fields

#### ⚠️ **ISSUE: GST Calculation Currency**
- **Status**: GST calculated in INR only
- **Impact**: Low - Acceptable if exchange rate handled separately
- **Note**: Ensure GST always calculated in INR regardless of invoice currency

---

### F. Tax Section - NEEDS IMPROVEMENT

#### ⚠️ **ISSUE: LUT Logic Not Fully Implemented**
- **Status**: `export_type` field exists but IGST rate not automatically set to 0% for LUT
- **Impact**: **HIGH** - LUT exports must have IGST @ 0%
- **Required Action**: 
  - When `export_type = 'wop'` (without payment), set IGST rate to 0%
  - Display "Export under LUT without payment of IGST" declaration

#### ✅ **Present**: IGST field, CGST/SGST correctly hidden

---

### G. Mandatory Declaration Text - MISSING

#### ❌ **MISSING: Export Declaration for LUT**
- **Status**: NOT IMPLEMENTED
- **Impact**: **HIGH** - Required for LUT exports
- **Required Text**: "Supply meant for export under LUT without payment of IGST."

#### ❌ **MISSING: General Export Declaration**
- **Status**: Generic certification exists but not export-specific
- **Impact**: **HIGH** - Required for customs
- **Required Text**: "We hereby certify that the goods mentioned are of Indian origin and the information is true and correct."

#### ⚠️ **PARTIAL: Certification Text**
- **Status**: Generic "Certified that the particulars given above are true and correct" exists
- **Impact**: Low - Should be export-specific

---

### H. Bank & Payment Details - GAPS

#### ⚠️ **PARTIAL: Bank Details**
- **Status**: Bank fields exist in template settings but not populated
- **Impact**: Medium - Required for foreign remittance
- **Required Action**:
  - Add bank details to business settings
  - Add `swift_code` field (critical for international transfers)
  - Display bank details in export invoice template

#### ❌ **MISSING: SWIFT Code**
- **Status**: NOT IMPLEMENTED
- **Impact**: **HIGH** - Required for international wire transfers
- **Required Action**: Add `swift_code` to business settings

---

### I. Signature & Authorization - PARTIAL

#### ✅ **Present**: Signature section, authorized signatory placeholder

#### ⚠️ **MISSING: Place and Date**
- **Status**: Date present but place not shown
- **Impact**: Low - Some prefer explicit place mention

---

## 3. ❌ NON-COMPLIANCE (CRITICAL ISSUES)

### CRITICAL NON-COMPLIANCE ITEMS:

1. **❌ IEC Code Missing** - MANDATORY for all exporters
2. **❌ Country of Destination Missing** - Required for customs
3. **❌ Export Declarations Missing** - Required for LUT and customs
4. **❌ LUT Logic Incomplete** - IGST not set to 0% for LUT exports
5. **❌ Currency Handling Incomplete** - No per-invoice currency selection
6. **❌ Shipping Details Incomplete** - Missing ports, Incoterms, transport mode
7. **❌ SWIFT Code Missing** - Required for international payments

---

## 4. 🔧 RECOMMENDED FIXES

### PRIORITY 1 (CRITICAL - Must Fix Before Production):

1. **Add IEC Code Field**
   ```sql
   ALTER TABLE businesses ADD COLUMN iec_code VARCHAR(10);
   ```
   - Add to business settings UI
   - Make mandatory for export invoices
   - Display in export invoice template

2. **Add Country Field to Customers**
   ```sql
   ALTER TABLE customers ADD COLUMN country VARCHAR(100) DEFAULT 'India';
   ```
   - Add country selector in customer form
   - Make mandatory for export invoice customers
   - Display prominently in export invoice template

3. **Implement LUT Logic**
   - When `export_type = 'wop'`, set IGST rate to 0% for all items
   - Display "Export under LUT without payment of IGST" declaration
   - Update tax calculation logic

4. **Add Export Declarations**
   - Add LUT declaration text
   - Add general export declaration
   - Display in export invoice template

5. **Add Currency Handling**
   ```sql
   ALTER TABLE invoices ADD COLUMN invoice_currency VARCHAR(3) DEFAULT 'INR';
   ALTER TABLE invoices ADD COLUMN exchange_rate DECIMAL(10,4);
   ALTER TABLE invoices ADD COLUMN base_currency_amount DECIMAL(12,2);
   ```
   - Add currency selector in export invoice form
   - Add exchange rate input
   - Display currency in template

### PRIORITY 2 (HIGH - Should Fix Soon):

6. **Add Shipping Details**
   ```sql
   ALTER TABLE invoices ADD COLUMN country_of_origin VARCHAR(100) DEFAULT 'India';
   ALTER TABLE invoices ADD COLUMN port_of_loading VARCHAR(100);
   ALTER TABLE invoices ADD COLUMN port_of_discharge VARCHAR(100);
   ALTER TABLE invoices ADD COLUMN place_of_delivery VARCHAR(255);
   ALTER TABLE invoices ADD COLUMN incoterms VARCHAR(10);
   ALTER TABLE invoices ADD COLUMN awb_number VARCHAR(100);
   ALTER TABLE invoices ADD COLUMN bl_number VARCHAR(100);
   ```
   - Add fields to export invoice form
   - Display in export invoice template

7. **Add SWIFT Code**
   ```sql
   ALTER TABLE businesses ADD COLUMN swift_code VARCHAR(11);
   ```
   - Add to business settings
   - Display in export invoice template

8. **Add Transport Mode to Export Form**
   - Add transport mode selector (Air/Sea/Courier/Road)
   - Display in export invoice template

9. **Update Export Invoice Template**
   - Add all missing fields with proper `ifSetting` checks
   - Ensure proper layout for customs-friendly format
   - Add export-specific declarations

### PRIORITY 3 (MEDIUM - Nice to Have):

10. **Add Buyer Tax/VAT ID Field**
    ```sql
    ALTER TABLE invoices ADD COLUMN buyer_tax_id VARCHAR(50);
    ```

11. **Add Commercial Invoice Option**
    - Allow switching between "Tax Invoice" and "Commercial Invoice"

12. **Improve Bank Details Display**
    - Ensure all bank fields are properly displayed
    - Add account holder name field

---

## 5. 🟢 FINAL VERDICT

### **STATUS: ❌ NOT READY FOR PRODUCTION EXPORTS**

### **REASONS:**
1. **IEC Code Missing** - Mandatory for all exporters
2. **Country of Destination Missing** - Required for customs
3. **Export Declarations Missing** - Required for LUT and customs compliance
4. **LUT Logic Incomplete** - IGST not automatically set to 0%
5. **Currency Handling Incomplete** - No per-invoice currency support
6. **Shipping Details Incomplete** - Missing critical fields for customs

### **ESTIMATED EFFORT TO FIX:**
- **Priority 1 Fixes**: 2-3 days
- **Priority 2 Fixes**: 2-3 days
- **Priority 3 Fixes**: 1-2 days
- **Total**: 5-8 days of development

### **RECOMMENDATION:**
**DO NOT USE FOR REAL EXPORTS** until Priority 1 and Priority 2 items are fixed. The current implementation has critical gaps that will cause:
- Customs clearance issues
- GST audit problems
- Bank remittance delays
- Legal compliance risks

### **NEXT STEPS:**
1. Implement all Priority 1 fixes
2. Test with a sample export invoice
3. Get validation from a practicing CA/export consultant
4. Implement Priority 2 fixes
5. Conduct another audit
6. Only then consider production use

---

## APPENDIX: TEMPLATE SETTINGS CHECKLIST

### Missing Settings in `lib/template-defaults.ts`:

- `show_iec_code` - For displaying IEC code
- `show_country_of_origin` - For country of origin
- `show_port_of_loading` - For port of loading
- `show_port_of_discharge` - For port of discharge
- `show_place_of_delivery` - For place of delivery
- `show_incoterms` - For Incoterms
- `show_transport_mode` - For transport mode
- `show_awb_number` - For AWB number
- `show_bl_number` - For BL number
- `show_swift_code` - For SWIFT code
- `show_export_declaration` - For export declarations
- `show_lut_declaration` - For LUT declaration
- `show_invoice_currency` - For invoice currency
- `show_exchange_rate` - For exchange rate
- `show_buyer_country` - For buyer country
- `show_buyer_tax_id` - For buyer tax ID

### Template Fields to Add:

All above fields should be added to:
1. `types/template.ts` - TypeScript interface
2. `lib/template-defaults.ts` - Default settings
3. `templates/export_invoice/template.html` - Template rendering
4. Invoice design settings UI - User controls

---

**END OF AUDIT REPORT**

