# Tenant Isolation Final Report

**Date:** 2026-06-06  
**Input:** `docs/FINAL_ROUTE_SIGNOFF.md` (69 VULNERABLE routes)  
**Method:** `requireTenantBusinessId()` on every handler that used client-supplied `business_id` without session binding.

---

## Summary

| Metric | Before | After |
|--------|-------:|------:|
| **VULNERABLE routes** | 69 | **0** |
| **Fixed routes** | — | **69** |
| **rawQueryOnly (audit bucket)** | 75 | **6** |
| **tenantGuard (audit bucket)** | 75 | **144** |
| **Security tests** | 94 pass | **94 pass** |

**Success criteria met:** VULNERABLE = 0

---

## Remediation

All 69 routes classified VULNERABLE in `FINAL_ROUTE_SIGNOFF.md` now call `requireTenantBusinessId(request, claimedBusinessId)` before any SQL or side effect. The claimed ID comes from `searchParams.get('business_id')`, `body.business_id`, or both (whichever the handler already used), merged with `??` where both were supported.

### Pattern applied

```typescript
import { requireTenantBusinessId } from '@/lib/auth-helpers';

const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
if (!tenant.ok) return tenant.response;
const businessId = tenant.businessId;
```

POST/PATCH handlers with body `business_id` use the same helper after `request.json()`. Dynamic `[id]` routes that accepted both query and body use:

```typescript
requireTenantBusinessId(request, body.business_id ?? searchParams.get('business_id'))
```

### Special cases preserved

| Route | Note |
|-------|------|
| `/api/todos/check-reminders` | No `business_id` → cron path (`assertCronAuthorized` + global scan). With `business_id` → tenant guard then per-business run. |
| `/api/suppliers/[id]/approve` | Single tenant bind from query or body; linked-business authorization unchanged. |
| `/api/notifications/read-all` | Tenant bind on body or query branch; portal session gate unchanged. |

### Unchanged (per scope)

- **3 SAFE:** `/api/admin/billing/events`, `/api/cron/process-reversing-entries`, `/api/cron/refresh-profile-pictures`
- **3 FALSE POSITIVE:** `/api/gst/gstr2b/decision`, `/export`, `/reconcile` (validated via `assertGstr2bApiAccess`)

Existing RBAC (`authorize`, `enforceAccess`), feature checks (`assertFeatureAccess`), and subscription wrappers were not removed or weakened.

---

## Audit results (`node scripts/audit-business-id-classify.js`)

```json
{
  "tenantGuard": 144,
  "rawQueryOnly": 6,
  "rawBodyOnly": 1,
  "helperOnly": 171,
  "mixed": 11,
  "pathBizId": 8
}
```

### Remaining raw-query routes (6)

These still read `searchParams.get('business_id')` in the route file without inline `requireTenantBusinessId`. All are intentionally excluded from remediation:

| Route | Sign-off classification |
|-------|-------------------------|
| `/api/admin/billing/events` | SAFE — platform admin filter |
| `/api/cron/process-reversing-entries` | SAFE — cron auth |
| `/api/cron/refresh-profile-pictures` | SAFE — cron auth |
| `/api/gst/gstr2b/decision` | FALSE POSITIVE — `assertGstr2bApiAccess` |
| `/api/gst/gstr2b/export` | FALSE POSITIVE — `assertGstr2bApiAccess` |
| `/api/gst/gstr2b/reconcile` | FALSE POSITIVE — `assertGstr2bApiAccess` |

### Remaining VULNERABLE routes

**0** — no routes remain cross-tenant IDOR via unbound client `business_id` among the original 75-route sign-off set.

---

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| `npm run test:security` | 94/94 pass |
| `audit-business-id-classify.js` | 6 rawQueryOnly (SAFE + FALSE POSITIVE only) |

---

## Fixed route list (69)

1. `/api/backup/history`  
2. `/api/backup/history/[id]/download`  
3. `/api/backup/history/[id]`  
4. `/api/backup/schedule`  
5. `/api/badges/counts`  
6. `/api/cloud-storage/google/auth`  
7. `/api/cloud-storage/google/credentials`  
8. `/api/cloud-storage/google/list`  
9. `/api/commission-rules/[id]`  
10. `/api/currencies`  
11. `/api/debug/template-assignment`  
12. `/api/delivery-challans`  
13. `/api/depreciation/calculate`  
14. `/api/document-attachments/[id]`  
15. `/api/employees/face-enrollment`  
16. `/api/employees/performance`  
17. `/api/employees/salary/advances/balance`  
18. `/api/employees/salary/advances/[id]/approve`  
19. `/api/employees/targets`  
20. `/api/employees/targets/[id]`  
21. `/api/exchange-rates`  
22. `/api/expense-categories`  
23. `/api/filters/presets`  
24. `/api/financial-years`  
25. `/api/financial-years/[id]/close`  
26. `/api/fixed-assets/depreciation-schedule`  
27. `/api/fixed-assets`  
28. `/api/holidays`  
29. `/api/holidays/[id]`  
30. `/api/inventory-adjustments/[id]`  
31. `/api/invoice-template-settings`  
32. `/api/invoices/next-number`  
33. `/api/items/[id]/batches`  
34. `/api/items/[id]/batches/[batchId]`  
35. `/api/items/[id]/serials`  
36. `/api/items/[id]/serials/[serialId]`  
37. `/api/items/[id]/valuation`  
38. `/api/journal-entries/templates`  
39. `/api/journal-entries/templates/[id]`  
40. `/api/leave-types`  
41. `/api/leave-types/[id]`  
42. `/api/locations`  
43. `/api/notifications/read-all`  
44. `/api/opening-balances`  
45. `/api/payment-methods`  
46. `/api/promotions/active`  
47. `/api/provisions`  
48. `/api/provisions/[id]/entries`  
49. `/api/provisions/[id]`  
50. `/api/settings/account-mappings`  
51. `/api/settings/ai-config`  
52. `/api/settings/item-sales-stock`  
53. `/api/settings/product-variants`  
54. `/api/settings/warehouses`  
55. `/api/settings/whatsapp-bot`  
56. `/api/shifts`  
57. `/api/shifts/[id]`  
58. `/api/suppliers/check-duplicate`  
59. `/api/suppliers/requests`  
60. `/api/suppliers/[id]/approve`  
61. `/api/tasks`  
62. `/api/tasks/[id]`  
63. `/api/tax-provisions`  
64. `/api/template-assignments`  
65. `/api/template-preview`  
66. `/api/todos/check-reminders`  
67. `/api/todos/users`  
68. `/api/tools/whatsapp-groups`  
69. `/api/warehouses/[id]/stock-availability`

---

*Tenant isolation remediation complete.*
