# Proforma Invoice vs Tax Invoice - Implementation Guide

## Overview

This document explains the differences between **Proforma Invoice** and **Tax Invoice** and how they are implemented in the system.

## Key Differences

| Feature | Tax Invoice | Proforma Invoice |
|---------|-------------|------------------|
| **Purpose** | Legal document for actual sale | Estimate/Quote for potential sale |
| **Stock Update** | ✅ Yes - Deducts stock when finalized | ❌ No - Does not affect stock |
| **GSTR-1 Filing** | ✅ Yes - Included in GST returns | ❌ No - Excluded from GST returns |
| **Ledger Entries** | ✅ Yes - Creates accounting entries | ❌ No - No accounting entries |
| **Customer Balance** | ✅ Yes - Updates receivables | ❌ No - Does not affect balance |
| **Receivables/Payables** | ✅ Yes - Included in calculations | ❌ No - Excluded from calculations |
| **Payments** | ✅ Yes - Can record payments | ❌ No - Payments blocked |
| **Legal Document** | ✅ Yes - Legally binding | ❌ No - Not legally binding |
| **Convert to Tax Invoice** | N/A | ✅ Yes - Can be converted |

## Implementation Details

### 1. Stock Updates
**Location:** `app/api/invoices/route.ts` (line 666)

```typescript
// Update stock if status is final AND not a proforma invoice
// Proforma invoices are estimates/quotes and don't affect stock
if (status === 'final' && item.item_id && document_type !== 'proforma_invoice') {
  // Stock deduction logic...
}
```

### 2. GSTR-1 Exclusion
**Location:** `app/api/reports/gst/gstr1/route.ts` (line 154)

```sql
WHERE i.business_id = $1 
  AND i.status = 'final'
  AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
```

### 3. Ledger Entries Exclusion
**Location:** `app/api/invoices/route.ts` (line 965)

```typescript
// Create ledger entries for invoice (only if status is final AND not a proforma invoice)
// Proforma invoices are estimates/quotes and don't create accounting entries
if (status === 'final' && document_type !== 'proforma_invoice') {
  await createInvoiceLedgerEntries({...});
}
```

### 4. Customer Balance Exclusion
**Location:** `app/api/invoices/route.ts` (line 1015)

```typescript
// Update customer current_balance (only if status is final and customer exists)
// Proforma invoices don't affect customer balance - they are estimates/quotes
if (status === 'final' && customer_id && document_type !== 'proforma_invoice') {
  // Update customer balance...
}
```

### 5. Payments Blocked
**Location:** `app/api/invoices/route.ts` (line 988) and `app/api/invoices/[id]/payments/route.ts` (line 22)

```typescript
// Proforma invoices don't accept payments - they are estimates/quotes
// Payments should only be recorded after converting to tax invoice
if (paymentEntries.length > 0 && document_type !== 'proforma_invoice') {
  // Create payment records...
}
```

**Payment API:**
```typescript
if (inv.document_type === 'proforma_invoice') {
  return NextResponse.json({ 
    error: 'Cannot record payment for proforma invoice. Please convert it to a tax invoice first.' 
  }, { status: 400 });
}
```

### 6. Receivables Exclusion
**Location:** `app/api/dashboard/overview/route.ts` (line 103)

```sql
SELECT id, invoice_date, due_date, grand_total, COALESCE(paid_amount, 0) as paid_amount
FROM invoices
WHERE business_id = $1
  AND status != 'cancelled'
  AND (document_type IS NULL OR document_type != 'proforma_invoice')
  AND (grand_total - COALESCE(paid_amount, 0)) > 0
```

### 7. Convert to Tax Invoice
**Location:** `app/api/invoices/[id]/convert-to-tax-invoice/route.ts`

- Creates a new tax invoice with `status = 'draft'`
- Copies all items and details from proforma
- Generates new tax invoice number
- Marks proforma as converted (adds note)
- User can then finalize the tax invoice, which will:
  - Update stock
  - Create ledger entries
  - Update customer balance
  - Allow payments
  - Be included in GSTR-1

## UI Indicators

### Invoice List Page
- Proforma invoices show with prefix "PI-" (e.g., "PI-001")
- Tax invoices show with business prefix (e.g., "INV-001")

### Invoice Detail Page
- Proforma invoices show "Convert to Tax Invoice" button
- Payment recording is disabled for proforma invoices
- Clear visual distinction (badge/indicator)

## Use Cases

### When to Use Proforma Invoice
1. **Quotations/Estimates** - Send to customers before actual sale
2. **Advance Payment Requests** - Request payment before delivery
3. **Import/Export Documentation** - For customs clearance
4. **Internal Planning** - Track potential sales without affecting books

### When to Use Tax Invoice
1. **Actual Sale** - Goods/services have been delivered
2. **Legal Requirement** - Need GST-compliant invoice
3. **Stock Management** - Need to track inventory
4. **Accounting** - Need to record in books
5. **Payment Collection** - Need to track receivables

## Workflow

```
1. Create Proforma Invoice (PI-001)
   ├─ No stock update
   ├─ No ledger entries
   ├─ No customer balance update
   └─ No GSTR-1 inclusion

2. Send to Customer (for approval/quote)

3. Convert to Tax Invoice (INV-001)
   ├─ Creates new tax invoice as draft
   ├─ Copies all items and details
   └─ Marks proforma as converted

4. Finalize Tax Invoice
   ├─ Updates stock ✅
   ├─ Creates ledger entries ✅
   ├─ Updates customer balance ✅
   ├─ Allows payments ✅
   └─ Included in GSTR-1 ✅
```

## Testing Checklist

- [ ] Proforma invoice does not update stock when finalized
- [ ] Proforma invoice is excluded from GSTR-1 reports
- [ ] Proforma invoice does not create ledger entries
- [ ] Proforma invoice does not update customer balance
- [ ] Proforma invoice is excluded from receivables calculations
- [ ] Payment recording is blocked for proforma invoices
- [ ] "Convert to Tax Invoice" button appears on proforma invoice detail page
- [ ] Converted tax invoice has all correct data
- [ ] Converted tax invoice can be finalized and affects all systems correctly

