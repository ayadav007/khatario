# Template System Overhaul - Implementation Progress

**Date Started**: January 2, 2026  
**Status**: Phase 1-2 Complete, Phase 3-5 In Progress

## Overview

This document tracks the comprehensive overhaul of the template and document management system to support multiple document types with GST compliance.

---

## ✅ Phase 1: Database Migrations (COMPLETED)

### Files Created:
1. **`database/migrations/091_add_reason_for_transportation.sql`**
   - Added `reason_for_transportation` column to `delivery_challans` table
   - Valid values: supply, export, job_work, skd_ckd, recipient_not_known, line_sales, exhibition, others
   - GST Rule 55 compliant

2. **`database/migrations/092_add_gst_registration_type.sql`**
   - Added `gst_registration_type` column to `businesses` table
   - Valid values: regular, composition, unregistered
   - Auto-determines invoice document type based on business GST scheme
   - Migrated existing data

3. **`database/migrations/093_template_assignments.sql`**
   - Created `business_template_assignments` table
   - Stores per-document-type template assignments
   - Migrated existing settings from `invoice_template_settings`

---

## ✅ Phase 2: Template Registry System (COMPLETED)

### Files Created:
1. **`lib/template-registry.ts`**
   - Central registry of all 22 templates
   - Metadata for each template (id, name, category, forDocumentTypes, tags, etc.)
   - Helper functions:
     - `getTemplatesByDocumentType()`
     - `getTemplateById()`
     - `getAllCategories()`
     - `getTemplatesByGstType()`
     - `getDefaultTemplateForDocumentType()`

### Template Categories Defined:
- **Invoice** (6 templates): gst_standard, modern, classic, elegant, minimal, export_invoice
- **Bill of Supply** (3 templates): composition_standard, composition_modern, tax_exempt
- **Credit Note** (2 templates): standard, modern
- **Debit Note** (2 templates): standard, modern
- **Delivery Challan** (2 templates): standard, minimal
- **Sales/Purchase Order** (2 templates): professional
- **Work Order** (1 template): job_card
- **Thermal** (2 templates): 80mm, 58mm

---

## ✅ Phase 3: UI Updates (COMPLETED)

### Files Modified:

1. **`components/settings/BusinessProfileTab.tsx`**
   - Added `gst_registration_type` field to formData state
   - Created dropdown for GST Registration Type selection:
     - Regular (Normal GST)
     - Composition Scheme
     - Unregistered (No GSTIN)
   - Added informational text explaining each type
   - Added amber warning banner for Composition Scheme users
   - Made GSTIN field conditionally required based on registration type

2. **`app/delivery-challans/new/page.tsx`**
   - Added `reason_for_transportation` field to formData state (default: 'supply')
   - Created dropdown with 8 GST-compliant options:
     - Supply (Sale)
     - Export
     - Job Work
     - SKD/CKD
     - Recipient not known
     - For own use
     - Exhibition or fairs
     - Others
   - Added helper text explaining GST Rule 55 requirement

3. **`app/api/delivery-challans/route.ts`**
   - Updated POST handler to accept `reason_for_transportation`
   - Modified INSERT query to include the new field
   - Added parameter to VALUES array

---

## 🔄 Phase 4: Invoice Creation Logic (IN PROGRESS)

### Remaining Tasks:

1. **Auto-determine Document Type Based on GST Registration**
   - Update `app/invoices/new/page.tsx`:
     - Check `business?.gst_registration_type`
     - Force `documentType = 'bill_of_supply'` for composition scheme
     - Restrict allowed document types based on registration type
     - Hide document type selector for composition businesses

2. **Force 0% Tax for Bill of Supply**
   - Update `calculateRow` function:
     - Check if `documentType === 'bill_of_supply'`
     - Force CGST, SGST, IGST to 0
     - Set `taxAmount = 0` regardless of item tax rate

3. **Hide Tax Columns for Bill of Supply**
   - Item table: Hide "Tax" column when `documentType === 'bill_of_supply'`
   - Summary: Hide CGST, SGST, IGST rows when `documentType === 'bill_of_supply'`

4. **Add Composition Disclaimer Banner**
   - Show amber banner at top of invoice form for composition businesses
   - Text: "Composition Taxable Person - Not Eligible to Collect Tax on Supplies"

---

## ⏳ Phase 5: Create New Templates (PENDING)

### Templates to Create:

#### 1. Bill of Supply Templates (3)
- **`templates/bill_of_supply/composition_standard/`**
  - template.html: Clean design with prominent disclaimer
  - config.json: Settings specific to composition scheme
  - Features: No tax columns, simplified summary, legal disclaimer

- **`templates/bill_of_supply/composition_modern/`**
  - template.html: Modern aesthetic for composition scheme
  - config.json

- **`templates/bill_of_supply/tax_exempt/`**
  - template.html: For unregistered businesses
  - config.json

#### 2. Credit Note Templates (2)
- **`templates/credit_note/standard/`**
  - template.html: GST-compliant with "Reason for Credit" field
  - config.json

- **`templates/credit_note/modern/`**
  - template.html
  - config.json

#### 3. Debit Note Templates (2)
- **`templates/debit_note/standard/`**
  - template.html: GST-compliant with "Reason for Debit" field
  - config.json

- **`templates/debit_note/modern/`**
  - template.html
  - config.json

#### 4. Delivery Challan Templates (2)
- **`templates/delivery_challan/standard/`**
  - template.html: Includes reason for transportation, transport details
  - config.json

- **`templates/delivery_challan/minimal/`**
  - template.html: Simplified version
  - config.json

---

## ⏳ Phase 6: Update Existing Templates (PENDING)

### Templates to Modify:

1. **GST Standard** (`templates/gst_standard/template.html`)
   - Add `{{#ifEqual business.gst_registration_type 'composition'}}` disclaimer
   - Add reason_for_transportation display

2. **Classic** (`templates/classic/template.html`)
   - Same updates as GST Standard

3. **Modern** (`templates/modern/template.html`)
   - Same updates

4. **Elegant** (`templates/elegant/template.html`)
   - Same updates

5. **Export Invoice** (`templates/export_invoice/template.html`)
   - Already updated in previous work

---

## ⏳ Phase 7: Template Management UI (PENDING)

### New Components to Create:

1. **`components/settings/TemplateManagementTab.tsx`**
   - Main container with 3 sub-tabs
   - State management for active sub-tab

2. **`components/settings/ActiveTemplatesView.tsx`**
   - Grid of cards showing current assignments
   - 9 cards (one per document type)
   - Each card has: Preview thumbnail, "Change" button, "Customize" button

3. **`components/settings/TemplateLibraryView.tsx`**
   - Gallery view of all templates
   - Filter by document type dropdown
   - Search functionality
   - Category pills
   - "Assign Template" modal

4. **`components/settings/TemplateCustomizeView.tsx`**
   - Document type selector at top
   - Existing InvoiceDesignTab logic, but scoped to selected document type
   - Loads settings from `business_template_assignments` table

5. **`components/settings/TemplatePreviewModal.tsx`**
   - Full-screen preview modal
   - Renders template with sample data
   - Close button

### API Routes to Create:

1. **`app/api/templates/assignments/route.ts`**
   - GET: Fetch all template assignments for business
   - POST: Create/update template assignment

2. **`app/api/templates/library/route.ts`**
   - GET: Fetch all available templates from registry

3. **`app/api/templates/[templateId]/settings/route.ts`**
   - GET: Fetch settings for specific template
   - PATCH: Update settings

---

## ⏳ Phase 8: Update Settings Page (PENDING)

### Files to Modify:

1. **`app/settings/page.tsx`**
   - Rename "Invoice Design" tab to "Templates & Printing"
   - Update icon (FileText → Palette)
   - Render new `TemplateManagementTab` component

---

## ⏳ Phase 9: Testing & Validation (PENDING)

### Test Cases:

1. **Bill of Supply**
   - [ ] Composition scheme business auto-generates BOS
   - [ ] Tax fields hidden
   - [ ] Disclaimer appears on PDF
   - [ ] Grand total = Subtotal (no tax)

2. **Delivery Challan**
   - [ ] Reason for transportation dropdown works
   - [ ] Reason appears on generated PDF
   - [ ] Different reasons don't break generation

3. **Template Assignment**
   - [ ] Can assign different templates to different document types
   - [ ] Template settings persist per document type
   - [ ] Preview shows correct template

4. **GST Registration Type**
   - [ ] Changing to composition updates invoice behavior
   - [ ] Warning banner appears
   - [ ] Can still create other document types (proforma, orders)

---

## Migration Instructions

### To Run Migrations:

```bash
# Connect to your PostgreSQL database
psql -U your_username -d your_database_name

# Run migrations in order
\i database/migrations/091_add_reason_for_transportation.sql
\i database/migrations/092_add_gst_registration_type.sql
\i database/migrations/093_template_assignments.sql
```

### To Verify Migrations:

```sql
-- Check business table
SELECT gst_registration_type, COUNT(*) 
FROM businesses 
GROUP BY gst_registration_type;

-- Check delivery challans
\d delivery_challans

-- Check template assignments
SELECT * FROM business_template_assignments LIMIT 5;
```

---

## Next Steps

1. **IMMEDIATE**: Update invoice creation page to handle Bill of Supply logic
2. **NEXT**: Create Bill of Supply templates (3 templates)
3. **THEN**: Create Credit/Debit Note templates (4 templates)
4. **FINALLY**: Build Template Management UI (7 new components + 3 API routes)

---

## Dependencies

- All new code requires migrations to be run first
- Template system requires `lib/template-registry.ts`
- UI components depend on template assignments table
- Invoice creation logic depends on GST registration type field

---

**Last Updated**: January 2, 2026 21:45 IST  
**Completed**: 35% (Phases 1-3)  
**Estimated Remaining Time**: 8-10 hours of development

