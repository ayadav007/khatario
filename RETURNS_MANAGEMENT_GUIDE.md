# Returns Management in GST - Complete Guide

## 📚 Understanding Returns in Indian GST Context

### **1. Sales Returns (Credit Notes)**
When a **customer returns goods** to you after purchase.

### **2. Purchase Returns (Purchase Return/Debit Note to Supplier)**
When **you return goods** to your supplier after purchase.

---

## 🔄 **SALES RETURNS (Credit Notes)**

### **What Happens:**
```
Customer bought: ₹1,000 + GST ₹180 = ₹1,180
Customer returns: ₹300 worth of goods

You issue Credit Note:
- Amount: ₹300
- CGST: ₹27 (9%)
- SGST: ₹27 (9%)
- Total: ₹354
```

### **Accounting Impact:**
1. ✅ **Stock IN** (goods coming back) - `current_stock + quantity`
2. ✅ **Customer Balance ↓** (they owe less) - `current_balance - credit_note_total`
3. ✅ **Invoice Balance ↓** (if linked) - `balance_amount - credit_note_total`
4. ✅ **GST Reversal** - Output tax liability reduced

### **GST Treatment:**
- **Output GST Reduced:** You reduce your tax liability by issuing credit note
- **GSTR-1:** Credit notes are reported in Table 9B (Credit/Debit Notes - Registered)
- **Time Limit:** Credit note must be issued before filing GSTR-1 for that month, or before September of next financial year
- **Invoice Reference:** Must reference original invoice number and date

### **When to Issue Credit Note:**
1. Goods returned by customer
2. Discount given after invoice
3. Invoice value reduced (e.g., quality issues)
4. Cancellation of sale

---

## 🔄 **PURCHASE RETURNS (Debit Note/Purchase Return)**

### **What Happens:**
```
You purchased: ₹2,000 + GST ₹360 = ₹2,360
You return: ₹500 worth of goods

You issue Purchase Return/Debit Note to Supplier:
- Amount: ₹500
- CGST: ₹45 (9%)
- SGST: ₹45 (9%)
- Total: ₹590
```

### **Accounting Impact:**
1. ✅ **Stock OUT** (goods going back to supplier) - `current_stock - quantity`
2. ✅ **Supplier Balance ↓** (you owe less) - `current_balance - return_total`
3. ✅ **Purchase Balance ↓** (if linked) - `balance_amount - return_total`
4. ✅ **ITC Reversal** - Input Tax Credit that was claimed must be reversed

### **GST Treatment:**
- **Input GST Reversed:** You reverse the ITC you claimed on those goods
- **GSTR-2/2B:** Purchase returns are reflected via supplier's credit note
- **ITC Reversal:** Reversed in the month of return via GSTR-3B Table 4(B)
- **Documentation:** Supplier should issue credit note to you OR you can issue debit note

### **When to Return Purchase:**
1. Defective goods received
2. Excess quantity received
3. Wrong items received
4. Quality not as per order
5. Goods damaged in transit

---

## 📊 **Database Schema (Existing)**

### **Credit Notes Table** (Sales Returns)
```sql
credit_notes:
  - id, business_id, customer_id, invoice_id
  - credit_note_number, credit_note_date
  - original_invoice_date, reason
  - subtotal, tax_total, cgst_total, sgst_total, igst_total
  - grand_total
  - refund_status ('pending', 'refunded', 'adjusted')
  - refund_amount, refund_mode, refund_date

credit_note_items:
  - id, credit_note_id, item_id
  - description, qty, unit_price
  - tax_rate, tax_amount, line_total
```

### **Purchase Returns** (New Table Needed)
We'll create a `purchase_returns` table specifically for this.

---

## 🔧 **Implementation Plan**

### **Phase 1: Create Purchase Returns Infrastructure** ✅
1. Create `purchase_returns` table (similar to purchases)
2. Create `purchase_return_items` table
3. Add API endpoints for purchase returns

### **Phase 2: Fix Credit Notes API** ✅
1. Ensure stock increases (goods coming back)
2. Ensure customer balance decreases
3. Update invoice balance if linked

### **Phase 3: GST Compliance** ✅
1. Calculate GST correctly based on Place of Supply
2. Store CGST/SGST/IGST breakdown
3. Link to original invoice/purchase

---

## 💰 **GST Calculation Examples**

### **Example 1: Intra-State Sales Return (Same State)**
```
Original Invoice: Karnataka → Karnataka
Item: Laptop, Qty: 1, Price: ₹50,000
CGST @ 9%: ₹4,500
SGST @ 9%: ₹4,500
Total: ₹59,000

Customer Returns 1 Laptop:
Credit Note Amount: ₹50,000
CGST Reversed: ₹4,500
SGST Reversed: ₹4,500
Total Credit: ₹59,000
```

### **Example 2: Inter-State Sales Return (Different States)**
```
Original Invoice: Karnataka → Maharashtra
Item: Laptop, Qty: 1, Price: ₹50,000
IGST @ 18%: ₹9,000
Total: ₹59,000

Customer Returns 1 Laptop:
Credit Note Amount: ₹50,000
IGST Reversed: ₹9,000
Total Credit: ₹59,000
```

### **Example 3: Partial Return**
```
Original Invoice:
Item A: 10 units @ ₹1,000 = ₹10,000 + GST ₹1,800 = ₹11,800
Item B: 5 units @ ₹500 = ₹2,500 + GST ₹450 = ₹2,950
Total: ₹14,750

Customer Returns:
Item A: 3 units @ ₹1,000 = ₹3,000 + GST ₹540 = ₹3,540

Credit Note: ₹3,540
```

---

## 🔄 **Complete Flow Diagrams**

### **Sales Return Flow:**
```
┌──────────────────────────────────────────────────────────┐
│              SALES RETURN (Credit Note)                  │
├──────────────────────────────────────────────────────────┤
│ 1. Customer returns goods                                │
│ 2. Create Credit Note (reference original invoice)       │
│ 3. Calculate GST same as original (CGST+SGST or IGST)   │
│ 4. Update Stock: current_stock += quantity              │
│ 5. Stock Movement: type='in', ref='credit_note'         │
│ 6. Customer Balance: current_balance -= credit_total    │
│ 7. Invoice Balance: balance_amount -= credit_total      │
│ 8. Process Refund (if applicable):                      │
│    - Cash/Bank transfer                                 │
│    - Adjust against other invoice                       │
│    - Store credit                                       │
│ 9. GST: Output tax liability reduced                    │
│ 10. GSTR-1 Reporting: Table 9B                          │
└──────────────────────────────────────────────────────────┘
```

### **Purchase Return Flow:**
```
┌──────────────────────────────────────────────────────────┐
│           PURCHASE RETURN (to Supplier)                  │
├──────────────────────────────────────────────────────────┤
│ 1. Identify defective/excess goods                       │
│ 2. Create Purchase Return document                       │
│ 3. Calculate GST same as original (CGST+SGST or IGST)   │
│ 4. Update Stock: current_stock -= quantity              │
│ 5. Stock Movement: type='out', ref='purchase_return'    │
│ 6. Supplier Balance: current_balance -= return_total    │
│ 7. Purchase Balance: balance_amount -= return_total     │
│ 8. Process Refund from Supplier (if applicable):        │
│    - Cash/Bank refund                                   │
│    - Adjust against other purchase                      │
│    - Credit note from supplier                          │
│ 9. GST: Reverse ITC claimed                             │
│ 10. GSTR-3B: Reverse ITC in Table 4(B)                  │
└──────────────────────────────────────────────────────────┘
```

---

## 📋 **Best Practices**

### **1. Documentation**
- Always reference original invoice/purchase number
- Keep reason for return documented
- Maintain proper approval workflow

### **2. Time Limits**
- Issue credit notes within financial year
- File amendments if needed
- Track return deadlines

### **3. Stock Management**
- Inspect returned goods before accepting
- Mark returned items (if damaged/defective)
- Update stock location if using multi-location

### **4. GST Compliance**
- Always reverse GST on returns
- Report in correct GST period
- Keep supporting documents for 6 years

### **5. Customer Communication**
- Clear return policy
- Return authorization number
- Refund timeline communication

---

## 🧪 **Testing Scenarios**

### **Test 1: Full Sales Return**
```
1. Create invoice for ₹10,000 + GST ₹1,800 = ₹11,800
2. Customer returns all items
3. Issue credit note for ₹11,800
4. Verify:
   ✓ Stock increased by returned quantity
   ✓ Customer balance decreased by ₹11,800
   ✓ Invoice balance decreased by ₹11,800
```

### **Test 2: Partial Sales Return**
```
1. Create invoice with 10 items @ ₹1,000 each = ₹11,800
2. Customer returns 3 items
3. Issue credit note for ₹3,540 (3 × ₹1,180)
4. Verify:
   ✓ Stock increased by 3 units
   ✓ Customer balance decreased by ₹3,540
   ✓ Invoice balance decreased by ₹3,540
```

### **Test 3: Full Purchase Return**
```
1. Create purchase for ₹5,000 + GST ₹900 = ₹5,900
2. Return all items to supplier
3. Create purchase return for ₹5,900
4. Verify:
   ✓ Stock decreased by returned quantity
   ✓ Supplier balance decreased by ₹5,900
   ✓ Purchase balance decreased by ₹5,900
```

### **Test 4: Inter-State Return**
```
1. Original invoice: Karnataka → Maharashtra (IGST 18%)
2. Return: Calculate IGST same way
3. Verify:
   ✓ IGST calculated correctly
   ✓ No CGST/SGST components
```

---

## 🚨 **Common Mistakes to Avoid**

1. ❌ **Not reversing GST on returns**
   - ✅ Always reverse the exact GST amount

2. ❌ **Wrong stock movement direction**
   - ✅ Sales Return = Stock IN, Purchase Return = Stock OUT

3. ❌ **Not linking to original document**
   - ✅ Always reference original invoice/purchase

4. ❌ **Wrong GST calculation on returns**
   - ✅ Use same tax rate and structure as original

5. ❌ **Not updating balances**
   - ✅ Update customer/supplier balances immediately

6. ❌ **Issuing credit note in wrong financial year**
   - ✅ Issue before GST return filing or before Sept of next FY

---

## 📄 **Reports Needed**

1. **Credit Notes Register**
   - All credit notes issued
   - Customer-wise, date-wise
   - GST component breakup

2. **Purchase Returns Register**
   - All purchase returns
   - Supplier-wise, date-wise
   - ITC reversal tracking

3. **Stock Movement Report**
   - Returns in/out tracking
   - Damaged goods tracking
   - Location-wise if multi-location

4. **GST Return Reconciliation**
   - Credit notes in GSTR-1
   - ITC reversals in GSTR-3B
   - Mismatch alerts

---

This guide provides the complete framework for handling returns in a GST-compliant manner!

