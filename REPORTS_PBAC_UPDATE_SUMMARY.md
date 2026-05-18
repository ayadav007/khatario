# Reports PBAC Update Status

## Already Updated (16 routes)
1. ✅ app/api/reports/sales/summary/route.ts
2. ✅ app/api/reports/sales/invoice-wise/route.ts
3. ✅ app/api/reports/sales-summary/route.ts
4. ✅ app/api/reports/party/receivables/route.ts
5. ✅ app/api/reports/profit-loss/route.ts
6. ✅ app/api/reports/profit-loss/pdf/route.ts
7. ✅ app/api/reports/gst/gstr1/route.ts
8. ✅ app/api/reports/gst/gstr1/export/excel/route.ts
9. ✅ app/api/reports/stock/summary/route.ts
10. ✅ app/api/reports/balance-sheet/route.ts
11. ✅ app/api/reports/cash-flow/route.ts
12. ✅ app/api/reports/trial-balance/route.ts
13. ✅ app/api/reports/stock/movement/route.ts
14. ✅ app/api/reports/stock/valuation/route.ts
15. ✅ app/api/reports/gst/gstr2b/route.ts
16. ✅ app/api/reports/gst/gstr3b/route.ts

## Remaining Routes (43 routes)

### Basic Reports - `report.read` (about 20 routes)
- app/api/reports/sales/item-wise/route.ts
- app/api/reports/sales/party-wise/route.ts
- app/api/reports/sales/tax-wise/route.ts
- app/api/reports/sales/credit/route.ts
- app/api/reports/sales/returns/route.ts
- app/api/reports/sales/cancelled/route.ts
- app/api/reports/sales/discount/route.ts
- app/api/reports/sales/payment-mode/route.ts
- app/api/reports/purchase/summary/route.ts
- app/api/reports/purchase/invoice-wise/route.ts
- app/api/reports/purchase/supplier-wise/route.ts
- app/api/reports/purchase/tax-wise/route.ts
- app/api/reports/purchase/credit/route.ts
- app/api/reports/purchase/returns/route.ts
- app/api/reports/party/payables/route.ts
- app/api/reports/party/ledger/route.ts
- app/api/reports/party/ageing/route.ts
- app/api/reports/party/statement/route.ts
- app/api/reports/party/advances/route.ts
- app/api/reports/expense/summary/route.ts
- app/api/reports/expense/category-wise/route.ts
- app/api/reports/expense/cost-center/route.ts
- app/api/reports/expense/expense-vs-sales/route.ts
- app/api/reports/expense/monthly-profit/route.ts
- app/api/reports/expense/profit-loss/route.ts
- app/api/reports/aging/receivables/route.ts
- app/api/reports/aging/payables/route.ts
- app/api/reports/stock-summary/route.ts
- app/api/reports/purchase-summary/route.ts

### GST Reports - `report.gst.read` (4 routes)
- app/api/reports/sales/b2b-b2c/route.ts (GST report)
- app/api/reports/gst/gstr9/route.ts
- app/api/reports/gst/gstr1/filings/route.ts
- app/api/reports/gst/gstr1/[filingId]/mark-filed/route.ts

### Stock/Inventory Reports - `report.inventory.read` (8 routes)
- app/api/reports/stock/low-stock/route.ts
- app/api/reports/stock/low-stock-warehouse/route.ts
- app/api/reports/stock/expired/route.ts
- app/api/reports/stock/damaged/route.ts
- app/api/reports/stock/purchase-vs-sales/route.ts
- app/api/reports/stock/profit-margin/route.ts
- app/api/reports/stock/closing-stock/route.ts
- app/api/reports/stock/closing-stock/finalize/route.ts

### Financial Reports - `report.financial.read/export` (3 routes)
- app/api/reports/balance-sheet/pdf/route.ts (export)
- app/api/reports/cash-flow/pdf/route.ts (export)
- app/api/reports/trial-balance/pdf/route.ts (export)

### Other (1 route)
- app/api/reports/inter-branch-reconciliation/route.ts

## Pattern to Apply

### For Basic Reports:
```typescript
import { authorize, AuthorizationError } from '@/lib/authorization';

// In GET handler after subscription check:
const userId = searchParams.get('user_id');
const branchId = searchParams.get('branch_id');

if (!userId) {
  return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
}

try {
  await authorize(userId, 'report', 'read', {
    businessId,
    branchId: branchId || undefined,
    resource: { business_id: businessId, branch_id: branchId || null },
  });
} catch (error) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(error.toResponse(), { status: error.statusCode });
  }
  throw error;
}
```

### For GST Reports:
Same pattern but use `'report.gst'` instead of `'report'` and action is `'export'` if exportFormat exists.

### For Stock Reports:
Same pattern but use `'report.inventory'` and pass `warehouseId` instead of `branchId`.

### For Financial Reports:
Same pattern but use `'report.financial'` and action is `'export'` for PDF routes.

### For Export Routes:
Use `action: 'export'` instead of `'read'`.
