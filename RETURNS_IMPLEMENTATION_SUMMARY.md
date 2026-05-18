# Returns Management - Implementation Summary

## ✅ **What I've Created**

### **1. Complete Guide** (`RETURNS_MANAGEMENT_GUIDE.md`)
A comprehensive 300+ line guide covering:
- Sales Returns (Credit Notes) vs Purchase Returns
- GST calculation and compliance
- Accounting impact and stock movements
- Complete flow diagrams
- Testing scenarios
- Best practices and common mistakes

### **2. Database Migration** (`database/migrations/018_purchase_returns.sql`)
- Created `purchase_returns` table
- Created `purchase_return_items` table  
- Added proper indexes and triggers
- Tracks ITC reversal for GST compliance

---

## 🔧 **How Returns Work in Your App**

### **📦 SALES RETURNS (Customer Returns Goods to You)**

**Use:** **Credit Notes** (Already exists in your app)

**Flow:**
```
1. Customer bought goods and wants to return
2. Go to: Credit Notes → Create Credit Note
3. Select original invoice (optional)
4. Select customer
5. Add items being returned with quantities
6. GST automatically calculated (same rate as original)
7. Save Credit Note

System automatically:
✅ Stock INCREASES (goods coming back)
✅ Customer balance DECREASES (they owe you less)
✅ Invoice balance DECREASES (if linked)
✅ Stock movement recorded (type: 'in', ref: 'credit_note')
✅ GST output liability reduced
```

**API Endpoint:** `/api/credit-notes` (Already exists - needs fixing)

---

### **📦 PURCHASE RETURNS (You Return Goods to Supplier)**

**Use:** **Purchase Returns** (New feature - needs implementation)

**Flow:**
```
1. You purchased goods and need to return (defective/excess)
2. Go to: Purchase Returns → Create Return
3. Select original purchase (optional)
4. Select supplier
5. Add items being returned with quantities
6. GST automatically calculated (same rate as original)
7. Save Purchase Return

System automatically:
✅ Stock DECREASES (goods going back to supplier)
✅ Supplier balance DECREASES (you owe them less)
✅ Purchase balance DECREASES (if linked)
✅ Stock movement recorded (type: 'out', ref: 'purchase_return')
✅ ITC (Input Tax Credit) reversed
```

**API Endpoint:** `/api/purchase-returns` (Needs to be created)

---

## 🎯 **What Needs to Be Implemented**

### **Priority 1: Fix Credit Notes** (Sales Returns)
**File:** `app/api/credit-notes/route.ts`

**Current Issue:** Not updating stock and balances correctly

**Fixes Needed:**
```typescript
// POST handler should:
1. Insert credit note record
2. Insert credit note items
3. UPDATE stock: current_stock += quantity (goods coming back)
4. INSERT stock_movements: type='in', reference_type='credit_note'
5. UPDATE customer current_balance -= credit_note_grand_total
6. UPDATE invoice balance_amount -= credit_note_grand_total (if linked)
7. Process refund if applicable
```

---

### **Priority 2: Create Purchase Returns API**
**File:** `app/api/purchase-returns/route.ts` (New file)

**Implementation:**
```typescript
// GET handler:
- Fetch all purchase returns for business
- Join with suppliers and purchases tables
- Order by return_date DESC

// POST handler:
1. Validate input (business_id, return_date, items required)
2. Calculate GST based on place of supply
3. Insert purchase_return record
4. Insert purchase_return_items
5. UPDATE stock: current_stock -= quantity (goods going back)
6. INSERT stock_movements: type='out', reference_type='purchase_return'
7. UPDATE supplier current_balance -= return_grand_total
8. UPDATE purchase balance_amount -= return_grand_total (if linked)
9. Mark itc_reversed = true
10. Process refund tracking if applicable
```

---

### **Priority 3: Create UI Pages**

**Files to Create:**
1. `app/credit-notes/page.tsx` - List all credit notes
2. `app/credit-notes/new/page.tsx` - Create credit note form
3. `app/purchase-returns/page.tsx` - List all purchase returns
4. `app/purchase-returns/new/page.tsx` - Create purchase return form

---

## 📊 **GST Calculation Logic**

### **For Both Sales & Purchase Returns:**

```typescript
// Calculate place of supply
const businessStateCode = '29'; // Karnataka
const partyStateCode = customer.state_code || supplier.state_code;

// Intra-state (Same state) - Use CGST + SGST
if (businessStateCode === partyStateCode) {
  cgst = (taxable_amount * tax_rate / 2) / 100;
  sgst = (taxable_amount * tax_rate / 2) / 100;
  igst = 0;
}
// Inter-state (Different states) - Use IGST
else {
  igst = (taxable_amount * tax_rate) / 100;
  cgst = 0;
  sgst = 0;
}
```

---

## 🔄 **Complete Data Flow**

### **Sales Return (Credit Note):**
```sql
-- 1. Insert credit note
INSERT INTO credit_notes (...) VALUES (...);

-- 2. Insert items
INSERT INTO credit_note_items (...) VALUES (...);

-- 3. Update stock (goods coming back)
UPDATE items 
SET current_stock = current_stock + $quantity
WHERE id = $item_id;

-- 4. Record stock movement
INSERT INTO stock_movements (
  business_id, item_id, type, quantity, 
  reference_type, reference_id
) VALUES ($1, $2, 'in', $3, 'credit_note', $4);

-- 5. Update customer balance (they owe less)
UPDATE customers
SET current_balance = current_balance - $credit_total
WHERE id = $customer_id;

-- 6. Update linked invoice balance
UPDATE invoices
SET balance_amount = balance_amount - $credit_total,
    grand_total = grand_total - $credit_total
WHERE id = $invoice_id;
```

### **Purchase Return:**
```sql
-- 1. Insert purchase return
INSERT INTO purchase_returns (...) VALUES (...);

-- 2. Insert items
INSERT INTO purchase_return_items (...) VALUES (...);

-- 3. Update stock (goods going back)
UPDATE items 
SET current_stock = current_stock - $quantity
WHERE id = $item_id;

-- 4. Record stock movement
INSERT INTO stock_movements (
  business_id, item_id, type, quantity, 
  reference_type, reference_id
) VALUES ($1, $2, 'out', $3, 'purchase_return', $4);

-- 5. Update supplier balance (you owe less)
UPDATE suppliers
SET current_balance = current_balance - $return_total
WHERE id = $supplier_id;

-- 6. Update linked purchase balance
UPDATE purchases
SET balance_amount = balance_amount - $return_total,
    paid_amount = paid_amount - $return_total (if already paid)
WHERE id = $purchase_id;
```

---

## 🧪 **Testing Checklist**

### **Test Sales Return (Credit Note):**
```
□ Create invoice for 10 items @ ₹1,000 each (₹11,800 with GST)
□ Customer returns 3 items
□ Create credit note for 3 items (₹3,540)
□ Verify stock increased by 3
□ Verify customer balance decreased by ₹3,540
□ Verify invoice balance decreased by ₹3,540
□ Verify GST calculated correctly
□ Verify stock movement recorded
```

### **Test Purchase Return:**
```
□ Create purchase for 20 items @ ₹500 each (₹11,800 with GST)
□ Return 5 defective items to supplier
□ Create purchase return for 5 items (₹2,950)
□ Verify stock decreased by 5
□ Verify supplier balance decreased by ₹2,950
□ Verify purchase balance decreased by ₹2,950
□ Verify ITC reversal flagged
□ Verify stock movement recorded
```

---

## 📋 **Next Steps**

### **Immediate Actions:**
1. ✅ Run migration: `node scripts/run_migration.js database/migrations/018_purchase_returns.sql`
2. ⏳ Create `/api/purchase-returns/route.ts` API
3. ⏳ Fix `/api/credit-notes/route.ts` to update stock and balances
4. ⏳ Create UI pages for returns management
5. ⏳ Add returns to sidebar navigation
6. ⏳ Test end-to-end flows

### **Future Enhancements:**
- Return authorization workflow
- Quality inspection checklist
- Automatic refund processing
- Return analytics dashboard
- GSTR-1/3B integration for GST reporting

---

## 📚 **Reference Documents:**
1. `RETURNS_MANAGEMENT_GUIDE.md` - Complete conceptual guide
2. `database/migrations/018_purchase_returns.sql` - Database schema
3. `database/schema.sql` - Existing credit_notes schema (lines 562-605)
4. `app/api/credit-notes/route.ts` - Existing credit notes API (needs fixing)

---

**Summary:** You now have a complete understanding of how to handle returns in a GST-compliant manner. The database structure is ready, and you need to implement the APIs and UI to complete the feature.

Would you like me to implement the API endpoints next?

