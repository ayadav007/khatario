# Chart of Accounts Update Guide
## Complete Reference: Which Accounts Get Updated for Each Transaction Type

This document provides a comprehensive guide to all chart of accounts updates in the system, showing exactly which accounts are debited and credited for each transaction type.

---

## Default Account Codes

| Account Type | Default Code | Account Name |
|--------------|-------------|--------------|
| **Assets** | | |
| Cash | 1101 | Cash |
| Bank | 1102 | Bank Account |
| Accounts Receivable | 1103 | Accounts Receivable |
| Inventory | 1104 | Inventory |
| **Liabilities** | | |
| Accounts Payable | 2101 | Accounts Payable |
| **Revenue** | | |
| Sales | 4101 | Sales |
| **Expenses** | | |
| Purchases | 5101 | Purchases |
| Cost of Goods Sold (COGS) | 5101 | Cost of Goods Sold |
| Administrative Expenses | 5201 | Administrative Expenses |

*Note: Account codes can be customized via account mappings in business settings.*

---

## 1. INVOICE (Sales)

### **Scenario A: Cash Sale** (No customer OR full payment received at invoice creation)

| Entry # | Account | Debit | Credit | Description |
|---------|---------|-------|--------|-------------|
| 1 | Cash/Bank (1101/1102) | Grand Total | 0 | Cash received from sale |
| 2 | Sales (4101) | 0 | Grand Total | Sales revenue recognized |
| **3** | **COGS (5101)** | **COGS Amount** | **0** | **Cost of goods sold (if inventory items)** |
| **4** | **Inventory (1104)** | **0** | **COGS Amount** | **Inventory reduction (if inventory items)** |

**When:** Invoice status = `'final'` AND document_type ≠ `'proforma_invoice'`

**Example:**
- Invoice Amount: ₹10,000
- COGS: ₹6,000
- **Result:**
  - Cash: +₹10,000 (Debit)
  - Sales: +₹10,000 (Credit)
  - COGS: +₹6,000 (Debit)
  - Inventory: -₹6,000 (Credit)

---

### **Scenario B: Credit Sale** (Customer selected, payment not received)

| Entry # | Account | Debit | Credit | Description |
|---------|---------|-------|--------|-------------|
| 1 | Accounts Receivable (1103) | Grand Total | 0 | Customer owes this amount |
| 2 | Sales (4101) | 0 | Grand Total | Sales revenue recognized |
| **3** | **COGS (5101)** | **COGS Amount** | **0** | **Cost of goods sold (if inventory items)** |
| **4** | **Inventory (1104)** | **0** | **COGS Amount** | **Inventory reduction (if inventory items)** |

**When:** Invoice status = `'final'` AND document_type ≠ `'proforma_invoice'` AND customer_id exists AND payment not received

**Example:**
- Invoice Amount: ₹10,000
- COGS: ₹6,000
- **Result:**
  - Accounts Receivable: +₹10,000 (Debit)
  - Sales: +₹10,000 (Credit)
  - COGS: +₹6,000 (Debit)
  - Inventory: -₹6,000 (Credit)

---

## 2. PAYMENT (Receipt/Payment)

### **Scenario A: Payment Received from Customer** (Receipt)

| Entry # | Account | Debit | Credit | Description |
|---------|---------|-------|--------|-------------|
| 1 | Cash/Bank (1101/1102) | Payment Amount | 0 | Cash received |
| 2 | Accounts Receivable (1103) | 0 | Payment Amount | Customer receivable reduced |

**When:** Payment type = `'receivable'` AND customer_id exists

**Example:**
- Payment Amount: ₹5,000
- **Result:**
  - Cash/Bank: +₹5,000 (Debit)
  - Accounts Receivable: -₹5,000 (Credit)

---

### **Scenario B: Payment Made to Supplier** (Payment)

| Entry # | Account | Debit | Credit | Description |
|---------|---------|-------|--------|-------------|
| 1 | Accounts Payable (2101) | Payment Amount | 0 | Supplier payable reduced |
| 2 | Cash/Bank (1101/1102) | 0 | Payment Amount | Cash paid out |

**When:** Payment type = `'payable'` AND supplier_id exists

**Example:**
- Payment Amount: ₹8,000
- **Result:**
  - Accounts Payable: -₹8,000 (Debit)
  - Cash/Bank: -₹8,000 (Credit)

---

## 3. PURCHASE

### **Scenario A: Cash Purchase** (No supplier OR full payment made)

| Entry # | Account | Debit | Credit | Description |
|---------|---------|-------|--------|-------------|
| 1 | Purchases (5101) | Grand Total | 0 | Purchase expense |
| 2 | Cash/Bank (1101/1102) | 0 | Grand Total | Cash paid |
| **3** | **Inventory (1104)** | **Inventory Amount** | **0** | **Inventory addition (if goods)** |
| **4** | **Purchases (5101)** | **0** | **Inventory Amount** | **Transfer from Purchases to Inventory** |

**When:** Purchase status = `'final'` AND (no supplier_id OR paid_amount >= grand_total)

**Example:**
- Purchase Amount: ₹12,000
- Inventory Value: ₹12,000
- **Result:**
  - Purchases: +₹12,000 (Debit), then -₹12,000 (Credit) = Net ₹0
  - Cash/Bank: -₹12,000 (Credit)
  - Inventory: +₹12,000 (Debit)

---

### **Scenario B: Credit Purchase** (Supplier selected, payment not made)

| Entry # | Account | Debit | Credit | Description |
|---------|---------|-------|--------|-------------|
| 1 | Purchases (5101) | Grand Total | 0 | Purchase expense |
| 2 | Accounts Payable (2101) | 0 | Grand Total | Supplier payable created |
| **3** | **Inventory (1104)** | **Inventory Amount** | **0** | **Inventory addition (if goods)** |
| **4** | **Purchases (5101)** | **0** | **Inventory Amount** | **Transfer from Purchases to Inventory** |

**When:** Purchase status = `'final'` AND supplier_id exists AND payment not made

**Example:**
- Purchase Amount: ₹12,000
- Inventory Value: ₹12,000
- **Result:**
  - Purchases: +₹12,000 (Debit), then -₹12,000 (Credit) = Net ₹0
  - Accounts Payable: +₹12,000 (Credit)
  - Inventory: +₹12,000 (Debit)

---

## 4. EXPENSE

| Entry # | Account | Debit | Credit | Description |
|---------|---------|-------|--------|-------------|
| 1 | Expense Account (5201 or custom) | Expense Amount | 0 | Expense recognized |
| 2 | Cash/Bank (1101/1102) | 0 | Expense Amount | Cash paid for expense |

**When:** Expense is created

**Example:**
- Expense Amount: ₹2,000
- Expense Account: Office Rent (5201)
- **Result:**
  - Office Rent: +₹2,000 (Debit)
  - Cash/Bank: -₹2,000 (Credit)

---

## 5. CREDIT NOTE (Sales Return)

| Entry # | Account | Debit | Credit | Description |
|---------|---------|-------|--------|-------------|
| 1 | Sales (4101) | Credit Note Amount | 0 | Sales reversal (reduce sales) |
| 2 | Accounts Receivable (1103) | 0 | Credit Note Amount | Customer receivable reduced |
| **3** | **COGS (5101)** | **0** | **COGS Amount** | **COGS reversal (reduce COGS)** |
| **4** | **Inventory (1104)** | **COGS Amount** | **0** | **Inventory addition (goods returned)** |

**When:** Credit note is created

**Example:**
- Credit Note Amount: ₹3,000
- COGS: ₹1,800
- **Result:**
  - Sales: -₹3,000 (Debit)
  - Accounts Receivable: -₹3,000 (Credit)
  - COGS: -₹1,800 (Credit)
  - Inventory: +₹1,800 (Debit)

---

## 6. PURCHASE RETURN (Debit Note to Supplier)

| Entry # | Account | Debit | Credit | Description |
|---------|---------|-------|--------|-------------|
| 1 | Purchases (5101) | 0 | Return Amount | Purchase reversal (reduce purchases) |
| 2 | Accounts Payable (2101) | Return Amount | 0 | Supplier payable reduced |
| **3** | **Inventory (1104)** | **0** | **Inventory Amount** | **Inventory reduction (goods returned)** |
| **4** | **Purchases (5101)** | **Inventory Amount** | **0** | **Reverse inventory transfer** |

**When:** Purchase return is created

**Example:**
- Return Amount: ₹2,000
- Inventory Value: ₹2,000
- **Result:**
  - Purchases: -₹2,000 (Credit), then +₹2,000 (Debit) = Net ₹0
  - Accounts Payable: -₹2,000 (Debit)
  - Inventory: -₹2,000 (Credit)

---

## 7. JOURNAL ENTRY

| Entry # | Account | Debit | Credit | Description |
|---------|---------|-------|--------|-------------|
| Multiple | Any Account(s) | As specified | As specified | Manual double-entry entries |

**When:** Journal entry is created manually

**Rules:**
- Total Debits MUST equal Total Credits
- Can involve any number of accounts
- Can be used for adjustments, corrections, transfers, etc.

**Example:**
- Transfer ₹5,000 from Cash to Bank
- **Result:**
  - Bank: +₹5,000 (Debit)
  - Cash: -₹5,000 (Credit)

---

## 8. OPENING BALANCE

| Entry # | Account | Debit | Credit | Description |
|---------|---------|-------|--------|-------------|
| 1 | Account/Customer/Supplier | Opening Balance | 0 | If debit balance |
| OR | Account/Customer/Supplier | 0 | Opening Balance | If credit balance |
| 2 | Capital/Retained Earnings | 0 | Opening Balance | If debit balance |
| OR | Capital/Retained Earnings | Opening Balance | 0 | If credit balance |

**When:** Opening balance is set for:
- Accounts
- Customers (opening receivable)
- Suppliers (opening payable)

**Example:**
- Customer Opening Balance: ₹10,000 (debit = customer owes)
- **Result:**
  - Accounts Receivable: +₹10,000 (Debit)
  - Capital/Retained Earnings: +₹10,000 (Credit)

---

## Summary Table: All Transaction Types

| Transaction Type | Accounts Debited | Accounts Credited | Additional Entries (if applicable) |
|------------------|------------------|-------------------|-----------------------------------|
| **Invoice (Cash Sale)** | Cash/Bank, COGS | Sales, Inventory | COGS & Inventory if goods |
| **Invoice (Credit Sale)** | Accounts Receivable, COGS | Sales, Inventory | COGS & Inventory if goods |
| **Payment (Receipt)** | Cash/Bank | Accounts Receivable | - |
| **Payment (Payment)** | Accounts Payable | Cash/Bank | - |
| **Purchase (Cash)** | Purchases, Inventory | Cash/Bank, Purchases | Inventory transfer if goods |
| **Purchase (Credit)** | Purchases, Inventory | Accounts Payable, Purchases | Inventory transfer if goods |
| **Expense** | Expense Account | Cash/Bank | - |
| **Credit Note** | Sales, Inventory | Accounts Receivable, COGS | COGS & Inventory reversal |
| **Purchase Return** | Accounts Payable, Purchases | Purchases, Inventory | Inventory reversal |
| **Journal Entry** | As specified | As specified | Manual entries |
| **Opening Balance** | Account/Customer/Supplier (if debit) | Capital/Retained Earnings (if debit) | Or vice versa for credit |

---

## Important Notes

1. **Double-Entry Principle:** Every transaction has equal debits and credits, maintaining accounting equation balance.

2. **Inventory Tracking:** COGS and Inventory entries are only created if:
   - Items are of type `'goods'` (not `'service'`)
   - Items have purchase prices/costs
   - Invoice/Purchase status is `'final'`

3. **Proforma Invoices:** Do NOT create ledger entries (they are estimates/quotes).

4. **Account Mappings:** Default account codes can be customized via business settings → Account Mappings.

5. **Payment Modes:** Cash, Bank, UPI, etc. can be mapped to specific accounts (Cash, Bank, etc.).

6. **Financial Year:** Opening balances are tracked per financial year.

---

## Account Nature Rules

| Account Type | Normal Balance | Increase | Decrease |
|--------------|----------------|----------|----------|
| **Assets** (Cash, Bank, AR, Inventory) | Debit | Debit | Credit |
| **Liabilities** (AP) | Credit | Credit | Debit |
| **Revenue** (Sales) | Credit | Credit | Debit |
| **Expenses** (Purchases, COGS, Expenses) | Debit | Debit | Credit |
| **Capital** | Credit | Credit | Debit |

---

## Example: Complete Sales Cycle

1. **Create Invoice (Credit Sale):** ₹10,000
   - Accounts Receivable: +₹10,000 (Debit)
   - Sales: +₹10,000 (Credit)
   - COGS: +₹6,000 (Debit)
   - Inventory: -₹6,000 (Credit)

2. **Receive Payment:** ₹10,000
   - Cash: +₹10,000 (Debit)
   - Accounts Receivable: -₹10,000 (Credit)

3. **Customer Returns Goods:** ₹2,000 (Credit Note)
   - Sales: -₹2,000 (Debit)
   - Accounts Receivable: -₹2,000 (Credit)
   - COGS: -₹1,200 (Credit)
   - Inventory: +₹1,200 (Debit)

**Net Result:**
- Sales: +₹8,000
- Cash: +₹10,000
- Accounts Receivable: -₹2,000 (net)
- COGS: +₹4,800
- Inventory: -₹4,800

---

*This guide covers all transaction types in the system. For custom account mappings, refer to your business settings.*
