# UI ↔ Database Connection Checklist

This document tracks what needs to be connected between the UI and the new GST compliance database schema.

---

## ✅ **ALREADY CONNECTED**

### Invoice Creation/Edit
- ✅ `place_of_supply_state_code` - Already captured and used
- ✅ GST calculation (CGST/SGST/IGST) - Already calculated
- ✅ Line-item GST breakdown - Calculated and stored in database
- ✅ Auto-classification of `supply_type` (B2B, B2C, Export, etc.)

### Customer Forms
- ✅ `state_code` - Forms calculate and send it
- ✅ Customer API saves `state_code` correctly

---

## ❌ **NEEDS CONNECTION**

### **1. TypeScript Type Definitions** 🔴 HIGH PRIORITY

**File:** `types/database.ts`

**Missing Fields:**

**Invoice Interface:**
- ❌ `cgst_total`, `sgst_total`, `igst_total` (already have `tax_total`)
- ❌ `document_type`, `supply_type`, `export_type`
- ❌ `shipping_bill_number`, `shipping_bill_date`, `port_code`
- ❌ `ecommerce_operator_gstin`, `is_ecommerce_supply`

**InvoiceItem Interface:**
- ❌ `taxable_value`
- ❌ `cgst_amount`, `sgst_amount`, `igst_amount`

**Customer Interface:**
- ✅ `state_code` - Already present

**Supplier Interface:**
- ❌ `state_code`

**Purchase Interface:**
- ❌ `cgst_total`, `sgst_total`, `igst_total`
- ❌ `place_of_supply_state_code`, `is_reverse_charge`
- ❌ `supplier_gstin`, `document_type`
- ❌ `itc_eligible`, `itc_availed`, `itc_availed_date`

**PurchaseItem Interface:**
- ❌ `hsn_sac`, `discount_percent`, `discount_amount`
- ❌ `taxable_value`, `tax_amount`
- ❌ `cgst_amount`, `sgst_amount`, `igst_amount`

**CreditNote Interface:**
- ❌ `cgst_total`, `sgst_total`, `igst_total`
- ❌ `place_of_supply_state_code`, `original_invoice_date`

**New Interfaces Needed:**
- ❌ `DebitNote` interface
- ❌ `DebitNoteItem` interface
- ❌ `AdvancePayment` interface
- ❌ `ItcReversal` interface

---

### **2. Supplier API** 🔴 HIGH PRIORITY

**File:** `app/api/suppliers/route.ts`

**Missing:**
- ❌ `state_code` in INSERT statement
- ❌ GET endpoint doesn't select `state_code`

**Fix Needed:**
```typescript
// In POST:
INSERT INTO suppliers (..., state, state_code, ...)

// In GET:
SELECT ..., state, state_code, ...
```

---

### **3. Supplier Forms** 🟡 MEDIUM PRIORITY

**Files:**
- `app/suppliers/new/page.tsx`
- `app/suppliers/[id]/edit/page.tsx` (if exists)

**Missing:**
- ❌ `state_code` calculation and submission
- Forms have `getStateCode` imported but may not be using it

**What to Add:**
- Auto-calculate `state_code` when state is selected
- Include `state_code` in form submission

---

### **4. Purchase API** 🔴 HIGH PRIORITY

**File:** `app/api/purchases/route.ts`

**Missing Fields in POST:**
- ❌ GST totals: `cgst_total`, `sgst_total`, `igst_total`
- ❌ `place_of_supply_state_code`
- ❌ `is_reverse_charge`
- ❌ `supplier_gstin` (denormalized)
- ❌ `document_type`
- ❌ `itc_eligible`, `itc_availed`, `itc_availed_date`

**Missing Fields in Purchase Items:**
- ❌ `hsn_sac`
- ❌ `discount_percent`, `discount_amount`
- ❌ `taxable_value`
- ❌ `tax_amount`
- ❌ `cgst_amount`, `sgst_amount`, `igst_amount`

**What to Fix:**
- Calculate GST breakdown similar to Invoice API
- Store line-item GST breakdown
- Denormalize `supplier_gstin` from suppliers table

---

### **5. Purchase Forms** 🟡 MEDIUM PRIORITY

**Files:**
- `app/purchases/page.tsx` (if has create form)
- `app/purchases/new/page.tsx` (if exists)

**Missing:**
- ❌ Place of Supply selection
- ❌ Reverse Charge checkbox
- ❌ Document Type selection
- ❌ ITC eligibility toggle
- ❌ HSN/SAC code input per item
- ❌ Discount fields per item
- ❌ GST breakdown display

---

### **6. Invoice Forms - Document Type Fields** 🟡 MEDIUM PRIORITY

**File:** `app/invoices/new/page.tsx`

**Missing UI Fields:**
- ❌ Export Invoice toggle/checkbox
- ❌ Shipping Bill Number/Date (for exports)
- ❌ Port Code (for exports)
- ❌ E-commerce Operator GSTIN (if applicable)
- ❌ Document Type selector (optional, can be auto-classified)

**Status:**
- ✅ API accepts these fields
- ✅ Auto-classification works
- ⚠️ User cannot manually override classification or set export details

---

### **7. Credit Note API & Forms** 🟡 MEDIUM PRIORITY

**Files:**
- `app/api/credit-notes/route.ts` (if exists)
- Credit note creation forms (if exist)

**Missing:**
- ❌ GST breakdown calculation
- ❌ `place_of_supply_state_code`
- ❌ `original_invoice_date` capture

---

### **8. Debit Note API & Forms** 🔴 HIGH PRIORITY

**Status:** Completely missing

**Need to Create:**
- ❌ `app/api/debit-notes/route.ts` (POST, GET, PATCH)
- ❌ Debit note creation form/page
- ❌ Debit note list page
- ❌ Debit note detail page

---

### **9. Advance Payments API & Forms** 🟡 MEDIUM PRIORITY

**Status:** Table exists, but no API/UI

**Need to Create:**
- ❌ `app/api/advance-payments/route.ts`
- ❌ Advance payment recording form (in invoice/purchase creation)
- ❌ Advance payment adjustment logic

---

### **10. Invoice Detail/Display Pages** 🟡 MEDIUM PRIORITY

**File:** `app/invoices/[id]/page.tsx`

**Missing Display:**
- ❌ Show `supply_type` badge (B2B, B2C Large, B2C Small, Export, SEZ)
- ❌ Show `document_type` if not 'regular'
- ❌ Show export details if export invoice
- ❌ Show line-item GST breakdown (CGST/SGST/IGST per item)

---

### **11. Purchase Detail/Display Pages** 🟡 MEDIUM PRIORITY

**Files:**
- `app/purchases/[id]/page.tsx` (if exists)

**Missing Display:**
- ❌ Show GST breakdown
- ❌ Show ITC eligibility/availed status
- ❌ Show reverse charge indicator
- ❌ Show line-item GST breakdown

---

## 📋 **IMPLEMENTATION PRIORITY**

### **Phase 1: Critical (Required for Data Collection)**
1. ✅ Update TypeScript types (`types/database.ts`)
2. ✅ Fix Supplier API to save `state_code`
3. ✅ Update Purchase API with GST calculation
4. ✅ Update InvoiceItem interface with GST fields

### **Phase 2: Important (Required for GST Reports)**
5. ✅ Create Debit Note API
6. ✅ Update Credit Note API (if exists)
7. ✅ Create Advance Payments API

### **Phase 3: UI Enhancements (User Experience)**
8. ✅ Add export fields to invoice form
9. ✅ Add GST breakdown display in invoice/purchase detail pages
10. ✅ Add document type badges/indicators

---

## 🎯 **Quick Wins**

These are easy fixes that will immediately improve GST compliance:

1. **Update `types/database.ts`** - Add missing fields to interfaces
2. **Fix Supplier API** - Add `state_code` to INSERT
3. **Update Purchase API** - Calculate and store GST breakdown (copy Invoice API logic)

---

## 📝 **Notes**

- All new fields have DEFAULT values in database, so existing code won't break
- Auto-classification works, but manual override should be available
- GST breakdown is calculated and stored, but UI may not display it yet
