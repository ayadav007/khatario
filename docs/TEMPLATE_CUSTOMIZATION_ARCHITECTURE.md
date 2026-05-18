# Template Customization Architecture

## Overview
This document explains where template customization information comes from and how it's applied during invoice rendering.

## Data Sources

### 1. **Template Settings (Customizations)** 📝
**Source:** Database tables storing user customizations

#### Primary Source: `business_template_assignments` (NEW SYSTEM)
```sql
business_template_assignments
├── business_id (UUID)
├── document_type (VARCHAR) -- 'tax_invoice', 'proforma_invoice', etc.
├── template_id (VARCHAR) -- 'gst_standard', 'modern', 'classic', etc.
└── settings (JSONB) -- All customization settings
```

**What it contains:**
- Show/hide toggles (`show_logo`, `show_customer_address`, etc.)
- Color settings (`primary_color`, `text_color`, `table_header_color`)
- Typography (`font_family`, `font_size`)
- Layout (`margin_top`, `margin_bottom`, etc.)
- Content (`terms`, `notes`, `bank_details`, etc.)
- **All 99+ customizable fields** from `TemplateSettings` interface

**When it's used:**
- ✅ **During invoice rendering** (via `/api/invoices/preview` or `/api/invoices/[id]/pdf`)
- ✅ **During template preview** (via `/api/template-preview`)
- ✅ **Per document type** (different templates for tax_invoice vs proforma_invoice)

#### Legacy Source: `invoice_template_settings` (BACKWARD COMPATIBILITY)
```sql
invoice_template_settings
├── business_id (UUID)
├── template_id (VARCHAR)
├── settings (JSONB)
└── is_default (BOOLEAN)
```

**Note:** This table is still used but being phased out in favor of `business_template_assignments`.

---

### 2. **Invoice Data (Actual Content)** 📄
**Source:** Invoice records in the database

#### Primary Source: `invoices` table
```sql
invoices
├── invoice_number
├── invoice_date
├── due_date
├── subtotal
├── discount_total
├── tax_total
├── grand_total
├── notes
├── terms
└── ... (all invoice fields)
```

#### Related Tables:
- `invoice_items` - Line items (products/services)
- `customers` - Customer information
- `businesses` - Business information (logo, address, GSTIN, etc.)

**What it contains:**
- Actual invoice numbers, dates, amounts
- Customer details (name, address, GSTIN)
- Line items (item names, quantities, prices, taxes)
- Totals (subtotal, tax, discount, grand total)
- Payment information (paid amount, balance)

**When it's used:**
- ✅ **Only during actual invoice rendering** (not in template preview)
- ✅ **Real data** from the database

---

### 3. **Business Data** 🏢
**Source:** `businesses` table + `bank_accounts` table

```sql
businesses
├── name
├── address_line1, address_line2
├── city, state, pincode
├── gstin, pan
├── logo_url
├── phone, email, website
└── ... (all business fields)

bank_accounts
├── business_id (FK)
├── account_name
├── account_number
├── bank_name
├── ifsc_code
├── branch_name
├── is_active
└── ... (other bank fields)
```

**What it contains:**
- Business name, address, contact info (from `businesses`)
- Logo image URL (from `businesses`)
- GSTIN, PAN, CIN (from `businesses`)
- Currency, invoice prefix (from `businesses`)
- **Bank details** (from `bank_accounts` table - first active account)

**When it's used:**
- ✅ **Both template preview AND actual invoice rendering**
- ✅ **Always fetched** from database
- ✅ **Bank details** are fetched from `bank_accounts` table and merged into business object

---

## Data Flow During Rendering

### Scenario 1: Template Preview (Customization Page)
```
User opens: /settings/templates/customize?template_id=modern

1. Frontend calls: GET /api/template-preview?template_id=modern&business_id=xxx&settings={...}
2. Backend:
   a. Fetches business logo from businesses table
   b. Uses sample/mock data for invoice content
   c. Applies settings from query parameter (user's current selections)
   d. Merges with default template settings
   e. Renders HTML using Handlebars template
3. Returns: HTML for iframe preview
```

**Data Sources:**
- ✅ **Settings:** From query parameter (user's UI selections)
- ✅ **Business Data:** From `businesses` table (logo, name, etc.)
- ✅ **Invoice Data:** **MOCK/SAMPLE DATA** (not real invoice)

---

### Scenario 2: Actual Invoice Preview/PDF
```
User clicks "Preview" on invoice page

1. Frontend calls: POST /api/invoices/preview
   Body: { templateId: 'modern', data: { invoice: {...}, business: {...}, customer: {...} } }

2. Backend:
   a. Determines document_type from invoice data
   b. Fetches template assignment from business_template_assignments
      WHERE business_id = X AND document_type = 'tax_invoice'
   c. Gets settings from assignment.settings (JSONB)
   d. Merges: defaults → saved settings → provided settings
   e. Transforms invoice data using prepareInvoiceForRendering()
   f. Renders HTML using Handlebars template
3. Returns: HTML for preview/PDF
```

**Data Sources:**
- ✅ **Settings:** From `business_template_assignments.settings` (database)
- ✅ **Business Data:** From request body (already fetched by frontend)
- ✅ **Invoice Data:** From request body (actual invoice from database)

---

### Scenario 3: Invoice PDF Generation
```
User clicks "Download PDF" on invoice page

1. Frontend calls: GET /api/invoices/[id]/pdf
2. Backend:
   a. Fetches invoice from database (invoices table)
   b. Fetches invoice items (invoice_items table)
   c. Fetches customer (customers table)
   d. Fetches business (businesses table)
   e. Determines document_type
   f. Fetches template assignment from business_template_assignments
   g. Gets settings from assignment.settings
   h. Merges with defaults
   i. Transforms data using prepareInvoiceForRendering()
   j. Renders HTML → Converts to PDF
3. Returns: PDF file
```

**Data Sources:**
- ✅ **Settings:** From `business_template_assignments.settings` (database)
- ✅ **Business Data:** From `businesses` table (database)
- ✅ **Invoice Data:** From `invoices` and `invoice_items` tables (database)

---

## Settings Priority (Merging Order)

When rendering, settings are merged in this order (later overrides earlier):

1. **Default Template Settings** (`getDefaultTemplateSettings(templateId)`)
   - Template-specific defaults (e.g., modern template has indigo primary color)
   - Defined in `lib/template-defaults.ts`

2. **Saved Settings** (from `business_template_assignments.settings`)
   - User's saved customizations from database
   - Highest priority for persistent settings

3. **Provided Settings** (from request body/query params)
   - Temporary settings (e.g., user is testing in preview)
   - Overrides saved settings for preview only

**Final Settings = merge(provided, saved, defaults)**

---

## Key Files

### Settings Storage & Retrieval
- `app/api/template-assignments/route.ts` - CRUD for template assignments
- `app/api/invoice-template-settings/route.ts` - Legacy settings API
- `app/settings/templates/customize/page.tsx` - Settings UI (saves to assignments)

### Settings Application
- `app/api/invoices/preview/route.ts` - Invoice preview (uses assignments)
- `app/api/template-preview/route.ts` - Template preview (uses query params)
- `lib/template-defaults.ts` - Default settings generator
- `lib/invoice-renderer.ts` - Handlebars rendering engine

### Settings Definition
- `types/template.ts` - `TemplateSettings` interface (99+ fields)

---

## Summary

| Information Type | Source | Used In |
|-----------------|--------|---------|
| **Template Customizations** | `business_template_assignments.settings` | Preview, PDF, Email |
| **Business Info** | `businesses` table | Preview, PDF, Email |
| **Bank Details** | `bank_accounts` table (first active account) | Preview, PDF, Email |
| **Invoice Content** | `invoices` + `invoice_items` tables | PDF, Email (not preview) |
| **Customer Info** | `customers` table | PDF, Email (not preview) |
| **Sample Data** | Hardcoded in `getSampleData()` | Template preview only |

---

## Important Notes

1. **Template Preview uses MOCK DATA** - The preview in customization page shows sample invoice data, not real invoices.

2. **Settings are per Document Type** - A business can have different templates/settings for:
   - Tax Invoice
   - Proforma Invoice
   - Bill of Supply
   - Credit Note
   - Debit Note
   - Delivery Challan
   - etc.

3. **Settings are per Business** - Each business has its own customizations stored in `business_template_assignments`.

4. **Settings override Template Defaults** - User customizations always override template defaults.

5. **Settings are JSONB** - All settings are stored as JSONB in PostgreSQL, allowing flexible schema.

6. **Bank Details are Separate** - Bank account details are stored in the `bank_accounts` table (not in `businesses` table). The system automatically fetches the first active bank account and merges it into the business object during rendering. If a business has multiple bank accounts, the oldest active account is used.

