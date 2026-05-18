# Balance Tracking Implementation - Comprehensive Fix

## Overview
This implementation fixes all data flow issues between invoices, purchases, payments, customers, suppliers, and stock management. Now all relationships are properly connected and balances are accurately maintained.

---

## 🔧 Database Changes

### New Migration: `017_comprehensive_balance_tracking.sql`

**To Run Migration:**
```bash
node scripts/run_migration.js database/migrations/017_comprehensive_balance_tracking.sql
```

**Changes Made:**
1. **Purchases table:**
   - Added `payment_status` VARCHAR(20) - tracks unpaid/partially_paid/paid
   - Added `balance_amount` DECIMAL(12,2) - outstanding balance

2. **Customers table:**
   - Added `current_balance` DECIMAL(12,2) - running balance including opening balance + invoices - payments

3. **Suppliers table:**
   - Added `current_balance` DECIMAL(12,2) - running balance including opening balance + purchases - payments

4. **Backfill Logic:**
   - Purchases: calculated balance_amount and payment_status from existing data
   - Customers: calculated current_balance from opening_balance + invoice balances
   - Suppliers: calculated current_balance from opening_balance + purchase balances

---

## ✅ What's Fixed

### 1. **Invoice Creation → Customer Balance**
- ✅ When invoice is created with `status = 'final'`:
  - Stock is deducted
  - Customer `current_balance` is increased by `balance_amount`
  - Payment records are created if payments included
  - Ledger entries are created

### 2. **Purchase Creation → Supplier Balance**
- ✅ When purchase is created with `status = 'final'`:
  - Stock is added
  - Supplier `current_balance` is increased by `balance_amount`
  - `payment_status` is set correctly
  - `balance_amount` is calculated and stored

### 3. **Invoice Status Changes**
- ✅ **Draft → Final:**
  - Stock deducted
  - Customer balance increased
- ✅ **Final → Cancelled:**
  - Stock restored
  - Customer balance decreased

### 4. **Payment In (Customer Payments)**
- ✅ When recording payment for invoice:
  - Invoice `paid_amount`, `balance_amount`, `payment_status` updated
  - Customer `current_balance` decreased by payment amount
  - Payment record created
  - Ledger entry created
- ✅ When recording standalone payment (no invoice):
  - Customer `current_balance` decreased directly
  - Payment record created
  - Ledger entry created

### 5. **Payment Out (Supplier Payments)**
- ✅ When recording payment for purchase:
  - Purchase `paid_amount`, `balance_amount`, `payment_status` updated
  - Supplier `current_balance` decreased by payment amount
  - Payment record created
  - Ledger entry created
- ✅ When recording standalone payment (no purchase):
  - Supplier `current_balance` decreased directly
  - Payment record created
  - Ledger entry created

### 6. **Dashboard Metrics**
- ✅ **Today's Sales:** Sum of invoices created today
- ✅ **Today's Purchases:** Sum of purchases created today
- ✅ **Receivables:** Sum of all customer `current_balance` (includes opening balances)
- ✅ **Payables:** Sum of all supplier `current_balance` (includes opening balances)

---

## 📊 Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                     INVOICE CREATION (Final)                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. Create invoice record                                        │
│ 2. Create invoice items                                         │
│ 3. Deduct stock (current_stock -= quantity)                     │
│ 4. Record stock movements (type: 'out')                         │
│ 5. Create payment records (if payments included)                │
│ 6. Update customer current_balance (+balance_amount)            │
│ 7. Create ledger entries                                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    PURCHASE CREATION (Final)                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. Create purchase record (with balance_amount, payment_status) │
│ 2. Create purchase items                                        │
│ 3. Add stock (current_stock += quantity)                        │
│ 4. Record stock movements (type: 'in')                          │
│ 5. Update supplier current_balance (+balance_amount)            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      PAYMENT IN (Customer)                      │
├─────────────────────────────────────────────────────────────────┤
│ 1. Create payment record                                        │
│ 2. Update invoice (paid_amount, balance_amount, payment_status) │
│ 3. Update customer current_balance (-payment_amount)            │
│ 4. Create ledger entry                                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      PAYMENT OUT (Supplier)                     │
├─────────────────────────────────────────────────────────────────┤
│ 1. Create payment record                                        │
│ 2. Update purchase (paid_amount, balance_amount, payment_status)│
│ 3. Update supplier current_balance (-payment_amount)            │
│ 4. Create ledger entry                                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   STANDALONE PAYMENTS                           │
├─────────────────────────────────────────────────────────────────┤
│ Payment In (no invoice):                                        │
│   → Customer current_balance decreased                          │
│ Payment Out (no purchase):                                      │
│   → Supplier current_balance decreased                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🧪 Testing Checklist

### Test 1: Invoice Creation with Payment
```
1. Create customer with opening_balance = 1000 (debit)
2. Create invoice for ₹500 with ₹200 payment
3. Verify:
   ✓ Stock deducted
   ✓ Invoice balance_amount = 300
   ✓ Invoice payment_status = 'partially_paid'
   ✓ Customer current_balance = 1000 + 300 = 1300
   ✓ Dashboard receivables includes customer balance
```

### Test 2: Purchase Creation
```
1. Create supplier with opening_balance = 2000 (credit)
2. Create purchase for ₹800 (draft first, then finalize)
3. Verify:
   ✓ Stock added
   ✓ Purchase balance_amount = 800
   ✓ Purchase payment_status = 'unpaid'
   ✓ Supplier current_balance = 2000 + 800 = 2800
   ✓ Dashboard payables includes supplier balance
```

### Test 3: Payment In
```
1. Customer has current_balance = 1500
2. Record payment of ₹500 for an invoice
3. Verify:
   ✓ Invoice balance_amount decreased by 500
   ✓ Invoice payment_status updated correctly
   ✓ Customer current_balance = 1500 - 500 = 1000
   ✓ Payment record created
```

### Test 4: Payment Out
```
1. Supplier has current_balance = 3000
2. Record payment of ₹1000 for a purchase
3. Verify:
   ✓ Purchase balance_amount decreased by 1000
   ✓ Purchase payment_status updated correctly
   ✓ Supplier current_balance = 3000 - 1000 = 2000
   ✓ Payment record created
```

### Test 5: Standalone Payments
```
1. Record payment in (no invoice) for customer: ₹300
2. Verify customer current_balance decreased by 300
3. Record payment out (no purchase) for supplier: ₹500
4. Verify supplier current_balance decreased by 500
```

### Test 6: Invoice Cancellation
```
1. Create and finalize invoice (stock deducted, customer balance increased)
2. Cancel the invoice
3. Verify:
   ✓ Stock restored
   ✓ Customer current_balance decreased
   ✓ Invoice status = 'cancelled'
```

### Test 7: Dashboard Accuracy
```
1. Check dashboard "Receivables" card
2. Verify it equals: SUM of all customer current_balance
3. Check dashboard "Payables" card
4. Verify it equals: SUM of all supplier current_balance
5. Both should include opening balances
```

### Test 8: Cash Sales (No Customer)
```
1. Create invoice without customer (customer_id = null)
2. Verify:
   ✓ Stock deducted
   ✓ Invoice created successfully
   ✓ No customer balance updated
   ✓ Payment records created (without ledger entry)
   ✓ Displays as "Cash Sale" in UI
```

---

## 🔍 API Changes Summary

### Modified Files:
1. **`app/api/purchases/route.ts`**
   - POST: Now calculates and stores `balance_amount` and `payment_status`
   - POST: Updates supplier `current_balance` when status is final
   - GET: Returns `balance_amount` and `payment_status`

2. **`app/api/invoices/route.ts`**
   - POST: Updates customer `current_balance` when status is final

3. **`app/api/invoices/[id]/route.ts`**
   - PATCH: Updates customer balance on Draft→Final transition
   - PATCH: Updates customer balance on Final→Cancelled transition

4. **`app/api/invoices/[id]/payments/route.ts`**
   - PATCH: Updates customer `current_balance` when payment recorded

5. **`app/api/purchases/[id]/payments/route.ts`**
   - PATCH: Updates `balance_amount` and `payment_status` in purchase
   - PATCH: Updates supplier `current_balance` when payment recorded

6. **`app/api/payments/route.ts`**
   - POST: Updates invoice/purchase balance and payment_status
   - POST: Updates customer/supplier `current_balance` for linked payments
   - POST: Updates customer/supplier `current_balance` for standalone payments

7. **`app/api/dashboard/overview/route.ts`**
   - GET: Receivables now sums customer `current_balance`
   - GET: Payables now sums supplier `current_balance`

8. **`app/api/customers/[id]/route.ts`**
   - GET: Uses `current_balance` instead of calculating manually

---

## 📝 Notes

### Opening Balance Handling:
- **Customer opening_balance_type = 'debit':** Customer owes you (adds to receivables)
- **Customer opening_balance_type = 'credit':** You owe customer (subtracts from receivables)
- **Supplier opening_balance_type = 'credit':** You owe supplier (adds to payables)
- **Supplier opening_balance_type = 'debit':** Supplier owes you (subtracts from payables)

The migration automatically handles these in the backfill logic.

### Current Balance Calculation:
```sql
-- Customer current_balance =
--   (opening_balance if debit, -opening_balance if credit)
--   + SUM(invoice balance_amount for status='final')
--   - SUM(payments)

-- Supplier current_balance =
--   (opening_balance if credit, -opening_balance if debit)
--   + SUM(purchase balance_amount for status='final')
--   - SUM(payments)
```

### Transaction Safety:
- All operations that modify multiple tables use database transactions
- Stock movements are always recorded alongside stock updates
- Balance updates are atomic with payment records

---

## 🚀 Deployment Steps

1. **Backup Database** (Important!)
   ```bash
   pg_dump khatario > backup_before_balance_tracking.sql
   ```

2. **Run Migration**
   ```bash
   node scripts/run_migration.js database/migrations/017_comprehensive_balance_tracking.sql
   ```

3. **Verify Migration**
   ```sql
   -- Check new columns exist
   SELECT column_name, data_type FROM information_schema.columns 
   WHERE table_name = 'purchases' AND column_name IN ('balance_amount', 'payment_status');
   
   SELECT column_name, data_type FROM information_schema.columns 
   WHERE table_name = 'customers' AND column_name = 'current_balance';
   
   SELECT column_name, data_type FROM information_schema.columns 
   WHERE table_name = 'suppliers' AND column_name = 'current_balance';
   ```

4. **Test Thoroughly** (Use checklist above)

5. **Monitor** - Check logs for any errors in balance calculations

---

## 🐛 Troubleshooting

### Issue: Customer balance doesn't match expected value
**Solution:**
```sql
-- Recalculate customer balance
UPDATE customers c
SET current_balance = (
  CASE WHEN c.opening_balance_type = 'debit' THEN COALESCE(c.opening_balance, 0) ELSE -COALESCE(c.opening_balance, 0) END
) + COALESCE(
  (SELECT SUM(balance_amount) FROM invoices WHERE customer_id = c.id AND status NOT IN ('cancelled', 'draft')),
  0
)
WHERE id = 'customer-id-here';
```

### Issue: Supplier balance doesn't match expected value
**Solution:**
```sql
-- Recalculate supplier balance
UPDATE suppliers s
SET current_balance = (
  CASE WHEN s.opening_balance_type = 'credit' THEN COALESCE(s.opening_balance, 0) ELSE -COALESCE(s.opening_balance, 0) END
) + COALESCE(
  (SELECT SUM(balance_amount) FROM purchases WHERE supplier_id = s.id AND status NOT IN ('cancelled', 'draft')),
  0
)
WHERE id = 'supplier-id-here';
```

### Issue: Dashboard shows wrong receivables/payables
**Solution:** Verify the query is using `current_balance`:
```sql
-- Check total receivables
SELECT SUM(current_balance) FROM customers WHERE business_id = 'your-business-id' AND is_active = true;

-- Check total payables
SELECT SUM(current_balance) FROM suppliers WHERE business_id = 'your-business-id' AND is_active = true;
```

---

## ✨ Summary

All data flows are now properly connected:
- ✅ Invoice → Stock → Customer Balance
- ✅ Purchase → Stock → Supplier Balance
- ✅ Payment In → Invoice → Customer Balance
- ✅ Payment Out → Purchase → Supplier Balance
- ✅ Standalone Payments → Customer/Supplier Balance
- ✅ Dashboard → Accurate Receivables/Payables with Opening Balances

The system now maintains accurate, real-time balances across all entities!

