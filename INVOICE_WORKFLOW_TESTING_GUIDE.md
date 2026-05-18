# Invoice Workflow Implementation - Testing Guide

## Overview
This document explains the complete invoice lifecycle workflow that has been implemented. The system now supports **Draft**, **Final**, and **Cancelled** invoice statuses, with proper payment tracking, stock management, and GST compliance.

---

## 🎯 What Has Changed

### 1. **Invoice Status System**
- **Three statuses**: `draft`, `final`, `cancelled`
- **Payment status**: `unpaid`, `partially_paid`, `paid`
- Invoices can only be paid when they are `final`
- Draft invoices don't affect stock or GST reports

### 2. **New Invoice Creation Flow**
- **Two save buttons** instead of one:
  - **"Save as Draft"**: Saves invoice as editable draft (no stock movement)
  - **"Save & Send"**: Finalizes invoice (deducts stock, locks invoice, opens share modal)

### 3. **Invoice Locking Rules**
When an invoice is **final**:
- ✅ Can edit: Payment details, notes, billing/shipping address
- ❌ Cannot edit: Items, quantities, prices, GST rates, discounts, totals

### 4. **Payment Recording**
- New "Record Payment" button on final invoices
- Payment modal to add payments
- Automatic payment status updates
- Payment history timeline

### 5. **Invoice Cancellation**
- "Cancel Invoice" button for final invoices
- Requires cancellation reason
- Reverses stock movements
- Resets payment status to unpaid
- Excludes from GST reports

### 6. **Visual Indicators**
- Status badges on invoice list and detail pages
- Color-coded badges (Draft/Gray, Final/Blue, Cancelled/Red)
- Payment status badges (Paid/Green, Partially/Yellow, Unpaid/Red)

---

## 📍 Where to Find Changes

### **1. New Invoice Page** (`/invoices/new`)
- **Location**: Create new invoice
- **Changes**:
  - Two buttons at bottom: "Save as Draft" and "Save & Send"
  - Draft banner appears after saving as draft
  - Fields become read-only after finalizing
  - Share modal opens after "Save & Send"

### **2. Invoice List Page** (`/invoices`)
- **Location**: Main invoices page
- **Changes**:
  - Status badges in Payment Status column
  - Shows both status (Draft/Final/Cancelled) and payment status badges

### **3. Invoice Detail Page** (`/invoices/[id]`)
- **Location**: View individual invoice
- **Changes**:
  - Status and payment badges in header
  - Conditional action buttons based on status
  - Payment information card for final invoices
  - Payment history timeline
  - Cancellation notice for cancelled invoices

---

## 🧪 Step-by-Step Testing Guide

### **TEST 1: Create and Save Draft Invoice**

**Steps:**
1. Go to `/invoices/new`
2. Fill in customer, items, and invoice details
3. Click **"Save as Draft"** button
4. Observe the yellow banner: "This invoice is in DRAFT. Finalize to update stock & GST."

**Expected Results:**
- ✅ Invoice is saved successfully
- ✅ Yellow draft banner appears
- ✅ All fields remain editable
- ✅ Stock quantities are **NOT** reduced
- ✅ Invoice appears in list with "DRAFT" badge
- ✅ Invoice is **NOT** included in GST/tax reports

**Verify:**
- Check items table: stock should remain unchanged
- Check invoice list: should show "DRAFT" badge

---

### **TEST 2: Finalize Draft Invoice**

**Steps:**
1. Create a draft invoice (from Test 1)
2. Go to invoice detail page
3. Click **"Save & Send"** button (or "Edit Invoice" → "Save & Send")
4. Confirm finalization

**Expected Results:**
- ✅ Invoice status changes to "FINAL"
- ✅ Stock quantities are **deducted** from items
- ✅ Invoice becomes locked (items/prices/taxes cannot be edited)
- ✅ Share modal opens automatically
- ✅ Invoice is included in GST reports
- ✅ "DRAFT" badge changes to "FINAL" badge

**Verify:**
- Check items table: stock should be reduced by invoice quantities
- Try editing items/prices: should be disabled
- Check invoice list: should show "FINAL" badge

---

### **TEST 3: Create Final Invoice Directly (Save & Send)**

**Steps:**
1. Go to `/invoices/new`
2. Fill in customer, items, and invoice details
3. Click **"Save & Send"** button directly
4. Share modal should open

**Expected Results:**
- ✅ Invoice is created with status = "final"
- ✅ Stock is deducted immediately
- ✅ Share modal opens with options (Email, WhatsApp, PDF, Copy Link)
- ✅ Invoice appears in list with "FINAL" badge
- ✅ Invoice is locked and ready for payment

**Verify:**
- Stock reduced immediately
- Share modal appears with all options

---

### **TEST 4: Record Payment on Final Invoice**

**Steps:**
1. Open a **final** invoice (status = "final")
2. Click **"Record Payment"** button
3. Fill in payment details:
   - Amount (should auto-suggest balance amount)
   - Payment Date
   - Payment Mode (Cash/UPI/Bank Transfer/etc.)
   - Reference/Transaction ID (optional)
4. Click **"Record Payment"**

**Expected Results:**
- ✅ Payment is recorded
- ✅ Payment status updates:
  - If payment = grand total → status becomes "paid"
  - If payment < grand total → status becomes "partially_paid"
  - If payment = 0 → status remains "unpaid"
- ✅ Payment appears in payment history timeline
- ✅ Balance amount decreases
- ✅ Paid amount increases

**Verify:**
- Check payment history section: new payment should appear
- Check payment status badge: should update accordingly
- Check balance: should decrease by payment amount

---

### **TEST 5: Multiple Payments (Partial Payments)**

**Steps:**
1. Create and finalize an invoice for ₹10,000
2. Record first payment of ₹3,000
3. Record second payment of ₹4,000
4. Record third payment of ₹3,000

**Expected Results:**
- ✅ First payment: status = "partially_paid", balance = ₹7,000
- ✅ Second payment: status = "partially_paid", balance = ₹3,000
- ✅ Third payment: status = "paid", balance = ₹0
- ✅ All three payments appear in payment history
- ✅ Payment status badge shows "PAID" after final payment

**Verify:**
- Payment history shows all 3 payments in chronological order
- Payment status updates correctly at each step

---

### **TEST 6: Cancel Final Invoice**

**Steps:**
1. Open a **final** invoice
2. Click **"Cancel Invoice"** button
3. Enter cancellation reason (required)
4. Click **"Confirm Cancellation"**

**Expected Results:**
- ✅ Invoice status changes to "cancelled"
- ✅ Stock quantities are **restored** (reversed)
- ✅ Payment status resets to "unpaid"
- ✅ Invoice is locked (no edit/payment buttons)
- ✅ Cancellation notice appears with reason
- ✅ Invoice is **excluded** from GST reports
- ✅ Badge shows "CANCELLED" (red)

**Verify:**
- Check items table: stock should be increased back
- Invoice detail page: shows cancellation notice with reason
- Only "PDF (Cancelled)" button is available
- Invoice list shows "CANCELLED" badge

---

### **TEST 7: Cancel Invoice with Payments**

**Steps:**
1. Create and finalize an invoice
2. Record a partial payment (e.g., ₹5,000 of ₹10,000)
3. Cancel the invoice

**Expected Results:**
- ✅ Invoice is cancelled
- ✅ Stock is restored
- ✅ Payment status resets to "unpaid"
- ⚠️ **Note**: Payments are not automatically refunded (they remain in payments table)

**Verify:**
- Payment status badge shows "unpaid" after cancellation
- Stock is restored correctly

---

### **TEST 8: Invoice List Badges**

**Steps:**
1. Go to `/invoices` (invoice list page)
2. Observe the "Payment Status" column

**Expected Results:**
- ✅ Each invoice shows **two badges**:
  - **Status badge** (top): DRAFT, FINAL, or CANCELLED
  - **Payment badge** (bottom): paid, partially paid, or unpaid
- ✅ Color coding:
  - Draft: Gray
  - Final: Blue
  - Cancelled: Red
  - Paid: Green
  - Partially Paid: Yellow
  - Unpaid: Red

**Verify:**
- All invoices display both badges correctly
- Colors match status/payment status

---

### **TEST 9: Conditional Actions on Detail Page**

**Steps:**
1. Open a **draft** invoice → Check available buttons
2. Open a **final** invoice → Check available buttons
3. Open a **cancelled** invoice → Check available buttons

**Expected Results:**

**Draft Invoice:**
- ✅ "Edit Invoice" button
- ✅ "Save & Send" button
- ❌ No "Record Payment" button
- ❌ No "Cancel Invoice" button

**Final Invoice:**
- ✅ "Record Payment" button (if not fully paid)
- ✅ "Share" button
- ✅ "PDF" button
- ✅ "Cancel Invoice" button
- ❌ No "Edit Invoice" button (invoice is locked)

**Cancelled Invoice:**
- ✅ "PDF (Cancelled)" button (disabled/non-functional)
- ❌ All other buttons disabled/hidden

**Verify:**
- Buttons appear/disappear based on invoice status
- Clicking locked fields should not allow edits

---

### **TEST 10: GST Report Compliance**

**Steps:**
1. Create 3 invoices:
   - Invoice A: Save as **Draft**
   - Invoice B: **Save & Send** (Final)
   - Invoice C: Finalize, then **Cancel**
2. Go to Reports page
3. Check sales summary report

**Expected Results:**
- ✅ Invoice A (Draft): **NOT** included in tax totals
- ✅ Invoice B (Final): **INCLUDED** in tax totals
- ✅ Invoice C (Cancelled): **NOT** included in tax totals
- ✅ Only final invoices appear in tax calculations

**Verify:**
- Tax total in reports should only include final invoices
- Draft and cancelled invoices are excluded from GST calculations

---

### **TEST 11: Stock Movement Verification**

**Steps:**
1. Note item stock quantity (e.g., Item X has 100 units)
2. Create draft invoice with 10 units of Item X
3. Check stock: should still be 100
4. Finalize invoice
5. Check stock: should be 90
6. Cancel invoice
7. Check stock: should be 100 again

**Expected Results:**
- ✅ Draft: No stock change
- ✅ Final: Stock reduced by invoice quantity
- ✅ Cancelled: Stock restored to original

**Verify:**
- Check items table stock after each action
- Stock movements should match invoice quantities

---

## 🚨 Edge Cases to Test

### **1. Payment Amount Validation**
- Try to record payment more than balance → Should show error
- Try to record ₹0 payment → Should show error
- Try negative amount → Should show error

### **2. Cancellation Validation**
- Try to cancel without reason → Should show error
- Try to cancel a draft invoice → Should not be allowed (only final can be cancelled)
- Try to cancel already cancelled invoice → Should show error

### **3. Editing Final Invoice**
- Try to edit items/quantities/prices on final invoice → Should be disabled
- Try to edit payment details → Should be allowed (not locked)
- Try to edit notes → Should be allowed

### **4. Payment on Draft Invoice**
- "Record Payment" button should not appear for draft invoices
- If accessed via API directly, should return error

---

## 📊 Database Changes

### **New Columns in `invoices` Table:**
- `status`: 'draft', 'final', 'cancelled'
- `payment_status`: 'unpaid', 'partially_paid', 'paid'
- `is_editable`: boolean (true for draft, false for final/cancelled)
- `cancellation_details`: JSONB (stores reason, cancelled_by, cancelled_at)
- `cgst_total`, `sgst_total`, `igst_total`: Tax breakdown

### **New API Endpoints:**
- `PATCH /api/invoices/[id]/finalize` - Finalize draft invoice
- `PATCH /api/invoices/[id]/payments` - Record payment
- `PATCH /api/invoices/[id]/cancel` - Cancel final invoice
- `GET /api/payments` - Fetch payment history

---

## ✅ Success Criteria Checklist

- [ ] Draft invoices can be created and edited freely
- [ ] Final invoices lock items/prices/taxes but allow payment editing
- [ ] Stock is deducted only when invoice is finalized
- [ ] Stock is restored when invoice is cancelled
- [ ] Payments can only be recorded on final invoices
- [ ] Payment status updates correctly (unpaid → partially_paid → paid)
- [ ] Cancelled invoices show reason and are excluded from GST
- [ ] Badges display correctly on list and detail pages
- [ ] Share modal opens after "Save & Send"
- [ ] GST reports only include final invoices
- [ ] All conditional actions work based on invoice status

---

## 🔍 Troubleshooting

### **Issue: "Record Payment" button not showing**
- **Check**: Invoice must be `status = 'final'`
- **Solution**: Finalize the invoice first

### **Issue: Cannot edit invoice items**
- **Check**: Invoice status is `final` or `cancelled`
- **Solution**: Only draft invoices can have items edited

### **Issue: Stock not reducing**
- **Check**: Invoice must be `status = 'final'`
- **Solution**: Finalize the invoice (draft invoices don't affect stock)

### **Issue: Payment status not updating**
- **Check**: Payment amount and invoice grand total
- **Solution**: Ensure payment API returns success, refresh invoice detail page

### **Issue: GST reports showing wrong totals**
- **Check**: Only invoices with `status = 'final'` should be included
- **Solution**: Verify invoice statuses and report query filters

---

## 📝 Notes

- **Draft invoices** are for internal use only (not sent to customers)
- **Final invoices** are the official invoices (affect stock, GST, payments)
- **Cancelled invoices** are preserved for audit but excluded from operations
- Payment recording is separate from invoice finalization
- Multiple partial payments are supported
- Stock movements are automatically tracked in `stock_movements` table

---

**Last Updated**: Implementation completed for complete invoice workflow with draft/final/cancelled statuses, payment recording, and GST compliance.

