# Testing Instructions - Template System Implementation
**Date**: January 2, 2026  
**Version**: 1.0  
**Estimated Testing Time**: 30-45 minutes

---

## 📋 Pre-Test Checklist

### ✅ Before You Begin:
- [ ] All migrations have been run successfully
- [ ] Development server is running (`npm run dev`)
- [ ] You have access to Settings → Business Profile
- [ ] You can create invoices and delivery challans

---

## 🧪 Test Suite

### Test 1: GST Registration Type in Business Settings
**Objective**: Verify the new GST registration type field works correctly

**Steps**:
1. Navigate to **Settings → Business Profile**
2. Scroll to the **"GST & Tax Information"** section
3. Locate the **"GST Registration Type"** dropdown
4. Verify you see 3 options:
   - ✅ Regular (Normal GST)
   - ✅ Composition Scheme
   - ✅ Unregistered (No GSTIN)

**Expected Results**:
- [ ] Dropdown is visible and functional
- [ ] Help text explains each option
- [ ] Current value is selected (default: Regular)

**Test Cases**:

#### 1A: Select "Composition Scheme"
- [ ] Select "Composition Scheme" from dropdown
- [ ] Verify amber warning banner appears below
- [ ] Banner text: "⚠️ Composition Scheme Notice"
- [ ] Banner explains: "All your invoices will automatically be generated as Bill of Supply"
- [ ] Click **Save Changes**
- [ ] Refresh page
- [ ] Verify "Composition Scheme" is still selected

**Status**: ⬜ Pass | ⬜ Fail  
**Notes**: ___________________________

---

### Test 2: Delivery Challan - Reason for Transportation
**Objective**: Verify GST Rule 55 compliance field

**Steps**:
1. Navigate to **Delivery Challans → New**
2. Scroll to find **"Reason for Transportation"** field
3. Verify it's **marked as required** (red asterisk)

**Expected Results**:
- [ ] Field is visible near vehicle/transport details
- [ ] Default value is "Supply (Sale)"
- [ ] Dropdown contains 8 options:
  - ✅ Supply (Sale)
  - ✅ Export
  - ✅ Job Work
  - ✅ SKD/CKD (Semi Knocked Down)
  - ✅ Recipient not known
  - ✅ For own use
  - ✅ Exhibition or fairs
  - ✅ Others

**Test Cases**:

#### 2A: Create Delivery Challan with Reason
- [ ] Fill in customer, items, vehicle number
- [ ] Select "Export" from Reason dropdown
- [ ] Click **Save**
- [ ] Verify challan is created successfully
- [ ] Open the challan
- [ ] Verify reason is displayed in the preview

**Status**: ⬜ Pass | ⬜ Fail  
**Notes**: ___________________________

---

### Test 3: Bill of Supply - Auto Creation (Composition Scheme)
**Objective**: Verify composition businesses auto-create Bill of Supply

**Prerequisites**:
- Business GST type must be set to **"Composition Scheme"** (from Test 1A)

**Steps**:
1. Navigate to **Invoices → New**
2. **DO NOT** manually select document type

**Expected Results**:

#### 3A: UI Changes
- [ ] Page loads with "Bill of Supply" automatically selected
- [ ] Amber composition banner is visible at top
- [ ] Banner text: "Composition Taxable Person - Not Eligible to Collect Tax on Supplies"
- [ ] Sub-text mentions: "Section 10 of CGST Act"
- [ ] **"Mark as Export Invoice"** checkbox is HIDDEN
- [ ] Document type selector is present but forced to BOS

#### 3B: Tax Column Hidden
- [ ] Add 2-3 items to the invoice
- [ ] Verify **"Tax"** column is HIDDEN in items table
- [ ] Table headers should be: #, Item Description, HSN, Qty, Price, Disc, **Total** (no Tax column)

#### 3C: Tax Calculation is Zero
- [ ] Add an item with 18% tax rate in master data
- [ ] Observe the item's tax is forced to 0%
- [ ] Total = Taxable Amount (no tax added)

#### 3D: GST Totals Hidden
- [ ] Scroll to summary section on right
- [ ] Verify **CGST**, **SGST**, **IGST** rows are HIDDEN
- [ ] Summary should show:
  - ✅ Taxable Amount
  - ✅ Total (same as taxable)
  - ❌ NO GST breakdown

**Status**: ⬜ Pass | ⬜ Fail  
**Notes**: ___________________________

---

### Test 4: Bill of Supply - Preview & PDF
**Objective**: Verify BOS preview shows correct template and disclaimer

**Prerequisites**:
- Continue from Test 3 (or create a new BOS)

**Steps**:
1. Fill in customer details
2. Add at least 2 items
3. Click **Preview** button

**Expected Results**:

#### 4A: Preview Modal
- [ ] Modal opens with iframe showing document
- [ ] Document title says **"BILL OF SUPPLY"** (not "Tax Invoice")
- [ ] Composition disclaimer is prominently displayed:
  - Background: Yellow/amber highlight
  - Text: "Composition Taxable Person - Not Eligible to Collect Tax on Supplies"
  - Sub-text: "Registered under Section 10..."

#### 4B: PDF Layout
- [ ] Items table shows item name, HSN, qty, rate, amount
- [ ] **NO** tax column in items table
- [ ] Summary section shows total **WITHOUT** GST breakdown
- [ ] Footer mentions this is a Bill of Supply

#### 4C: Save and Download
- [ ] Click **Save** (Save as Draft or Final)
- [ ] Go to **Invoices** list page
- [ ] Verify document shows as "Bill of Supply" in list
- [ ] Open the invoice detail page
- [ ] Click **Download PDF**
- [ ] Open the PDF
- [ ] Verify PDF matches preview (BOS title, disclaimer, no tax)

**Status**: ⬜ Pass | ⬜ Fail  
**Notes**: ___________________________

---

### Test 5: Regular Business - Tax Invoice Still Works
**Objective**: Ensure regular businesses aren't affected

**Steps**:
1. Go to **Settings → Business Profile**
2. Change GST Registration Type back to **"Regular"**
3. Save changes
4. Navigate to **Invoices → New**

**Expected Results**:

#### 5A: Normal Invoice Behavior
- [ ] Document type defaults to "Tax Invoice"
- [ ] **NO** composition banner visible
- [ ] **Tax column is VISIBLE** in items table
- [ ] Add an item with 18% tax
- [ ] Verify tax is calculated correctly (9% CGST + 9% SGST for intra-state)
- [ ] Summary shows CGST, SGST, or IGST breakdown
- [ ] Export checkbox is visible

#### 5B: Preview Shows Tax Invoice
- [ ] Click Preview
- [ ] Document title says **"TAX INVOICE"** (not Bill of Supply)
- [ ] NO composition disclaimer
- [ ] Items table includes tax column
- [ ] GST breakdown is visible in summary

**Status**: ⬜ Pass | ⬜ Fail  
**Notes**: ___________________________

---

### Test 6: Proforma Invoice Still Works
**Objective**: Ensure proforma invoices aren't affected by BOS changes

**Steps**:
1. Ensure business is set to "Regular" (from Test 5)
2. Navigate to **Invoices → New**
3. Click on **"Proforma Invoice"** button/tab

**Expected Results**:
- [ ] Document type changes to "Proforma Invoice"
- [ ] Tax column is still visible
- [ ] Tax calculations work normally
- [ ] Preview shows **"PROFORMA INVOICE"** title
- [ ] Can save and convert to tax invoice later

**Status**: ⬜ Pass | ⬜ Fail  
**Notes**: ___________________________

---

### Test 7: Database Integrity
**Objective**: Verify migrations and data consistency

**Steps**:
1. Open your database management tool (pgAdmin, TablePlus, etc.)
2. Connect to your database

**Run These Queries**:

```sql
-- Check GST registration type column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'businesses' 
AND column_name = 'gst_registration_type';
-- Expected: 1 row, type VARCHAR(20)

-- Check reason for transportation column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'delivery_challans' 
AND column_name = 'reason_for_transportation';
-- Expected: 1 row, type VARCHAR(50)

-- Check template assignments table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'business_template_assignments';
-- Expected: 1 row

-- Check your business GST type
SELECT name, gst_registration_type, gstin 
FROM businesses 
LIMIT 5;
-- Expected: Your business(es) with gst_registration_type value

-- Check any existing Bill of Supply invoices
SELECT invoice_number, document_type, grand_total 
FROM invoices 
WHERE document_type = 'bill_of_supply' 
ORDER BY created_at DESC 
LIMIT 5;
-- Expected: Any BOSinvoices you created during testing
```

**Expected Results**:
- [ ] All columns exist
- [ ] Template assignments table exists
- [ ] Your business has a gst_registration_type value
- [ ] BOS invoices (if created) are stored correctly

**Status**: ⬜ Pass | ⬜ Fail  
**Notes**: ___________________________

---

### Test 8: Edge Cases

#### 8A: Composition Business Cannot Create Tax Invoice
**Steps**:
1. Set business to "Composition Scheme"
2. Try to manually change document type to "Tax Invoice"

**Expected**: System should prevent or warn (future enhancement)  
**Current**: May allow but will still apply BOS rules

#### 8B: Unregistered Business
**Steps**:
1. Set GST Registration Type to "Unregistered"
2. Create new invoice

**Expected**: 
- [ ] Should create Bill of Supply (tax-exempt)
- [ ] No GSTIN shown on document
- [ ] No GST calculations

#### 8C: Delivery Challan Without Vehicle Number
**Steps**:
1. Create delivery challan
2. Leave vehicle number blank
3. Fill reason for transportation

**Expected**: 
- [ ] Should save successfully (vehicle optional)
- [ ] Reason is mandatory, vehicle is optional

**Status**: ⬜ Pass | ⬜ Fail  
**Notes**: ___________________________

---

## 🐛 Known Issues / Limitations

### Current Implementation:
1. **Template Management UI** - Not yet built (using existing Invoice Design settings)
2. **Auto-enforcement** - Composition businesses can still manually select other document types (UI shows but logic prevents)
3. **Modern/Minimal Variants** - Only standard templates created for Credit/Debit notes
4. **Template Preview Gallery** - Not available yet (will be added in Template Management UI phase)

### These Are NOT Bugs (By Design):
- Bill of Supply shows "0%" tax even if item has 18% - **CORRECT** (composition scheme rule)
- Tax column hidden for BOS - **CORRECT** (shouldn't show tax fields)
- Export checkbox hidden for composition - **CORRECT** (composition can't export with GST)

---

## ✅ Test Summary

| Test | Status | Critical | Notes |
|------|--------|----------|-------|
| 1. GST Registration Type | ⬜ | Yes | |
| 2. Delivery Challan Reason | ⬜ | Yes | |
| 3. Bill of Supply Auto-Creation | ⬜ | Yes | |
| 4. BOS Preview & PDF | ⬜ | Yes | |
| 5. Regular Invoice Still Works | ⬜ | Yes | |
| 6. Proforma Invoice Works | ⬜ | Medium | |
| 7. Database Integrity | ⬜ | Yes | |
| 8. Edge Cases | ⬜ | Medium | |

### Overall Result: ⬜ Pass | ⬜ Fail

---

## 🚨 If Tests Fail

### Common Issues and Fixes:

#### Issue: GST Registration Type dropdown not showing
**Fix**: 
- Clear browser cache
- Hard refresh (Ctrl+Shift+R)
- Check if you're on the Business Profile tab
- Verify migrations ran: `SELECT * FROM information_schema.columns WHERE table_name='businesses' AND column_name='gst_registration_type'`

#### Issue: Bill of Supply still shows tax
**Fix**:
- Verify business GST type is set to "Composition"
- Log out and log back in
- Check browser console for errors
- Verify `app/invoices/new/page.tsx` has the latest changes

#### Issue: Composition banner not showing
**Fix**:
- Ensure business GST type is saved properly
- Check if business object is being loaded correctly
- Inspect `(business as any)?.gst_registration_type` in browser console

#### Issue: Delivery challan reason field missing
**Fix**:
- Verify migration 091 ran successfully
- Check if column exists: `\d delivery_challans` (in psql)
- Ensure you're on the "New" delivery challan page, not edit

#### Issue: Template not found / PDF generation fails
**Fix**:
- Verify template files exist in `templates/bill_of_supply/composition_standard/`
- Check template has both `config.json` and `template.html`
- Restart dev server
- Check server logs for template errors

---

## 📞 Need Help?

### Debug Commands:

```javascript
// In browser console on invoice creation page
console.log('Business GST Type:', business?.gst_registration_type);
console.log('Document Type:', documentType);
console.log('Is Export:', isExport);
console.log('Tax Calculation:', calculateRow(rows[0]));
```

### Database Debug:

```sql
-- Check business GST type
SELECT id, name, gst_registration_type FROM businesses;

-- Check recent invoices
SELECT invoice_number, document_type, status, grand_total 
FROM invoices 
ORDER BY created_at DESC 
LIMIT 10;

-- Check delivery challan reasons
SELECT dc_number, reason_for_transportation, vehicle_number 
FROM delivery_challans 
ORDER BY created_at DESC 
LIMIT 10;
```

---

**Happy Testing! 🎉**

Report any issues or unexpected behavior for immediate investigation.

