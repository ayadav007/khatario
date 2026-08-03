# Security Foundation

Reusable building blocks for tenant-scoped API routes. **No routes use these helpers yet** — migrate incrementally without changing existing handler behavior until each route is updated.

**Location:** `lib/security/`

---

## Primitives

| Primitive | File | Purpose |
|-----------|------|---------|
| `requireOperationalSubscription()` | `require-operational-subscription.ts` | Subscription + platform-suspend gate |
| `withBusinessApi()` | `with-business-api.ts` | Full route wrapper (JWT tenant, RBAC, subscription, feature) |
| Types | `types.ts` | Shared option and context types |
| Examples | `examples.ts` | Copy-paste migration patterns (not imported by routes) |

---

## 1. `requireOperationalSubscription(businessId)`

Ensures a business may use operational product APIs.

### Allows

- Subscription status `active`
- Subscription status `trial` with a non-expired trial calendar

### Denies

| Condition | HTTP | Code |
|-----------|------|------|
| Missing subscription row | 403 | `NO_SUBSCRIPTION` |
| Platform suspended (`businesses.platform_suspended_at`) | 403 | `BUSINESS_SUSPENDED` |
| Status `expired` | 403 | `SUBSCRIPTION_EXPIRED` |
| Status `cancelled` | 403 | `SUBSCRIPTION_CANCELLED` |
| Other non-operational status | 403 | `SUBSCRIPTION_INACTIVE` |
| Calendar-expired trial | 403 | `TRIAL_EXPIRED` |
| Past `end_date` | 403 | `SUBSCRIPTION_EXPIRED` |

### Composes (does not replace)

- `isBusinessPlatformSuspended()` — `lib/admin-business-ops.ts`
- `getBusinessSubscription()` / `isSubscriptionOperationalStatus()` — `lib/subscription.ts`
- `checkTrialExpiry()` — `lib/subscription/lifecycle.ts`

Logic aligns with `enforceAccess()` and `assertFeatureAccess()` subscription checks, plus the platform-suspend check used at login.

### API surface

```typescript
import {
  requireOperationalSubscription,
  assertOperationalSubscription,
  operationalSubscriptionErrorResponse,
  OperationalSubscriptionError,
} from '@/lib/security';

// Throwing (use in try/catch)
const subscription = await requireOperationalSubscription(businessId);

// Result tuple (early return)
const gate = await assertOperationalSubscription(businessId);
if (!gate.ok) return gate.response;

// Catch mapping
catch (error) {
  const res = operationalSubscriptionErrorResponse(error);
  if (res) return res;
  throw error;
}
```

---

## 2. `withBusinessApi(options, handler)`

Wraps a Next.js App Router handler with a consistent security pipeline.

### Pipeline (in order)

1. **Resolve params** — supports sync or `Promise` params (Next.js 15)
2. **Optional JSON body** — when `parseJsonBody: true`
3. **Tenant validation** — `requireTenantBusinessId(request, claimedBusinessId)` (JWT only; IDOR protection)
4. **User id** — `getUserIdFromRequest()` → 401 if missing
5. **Operational subscription** — `requireOperationalSubscription()`
6. **RBAC** — `authorize(userId, module, action, authContext)`
7. **Feature / report** — `assertFeatureAccess()` or `assertReportAccess()` when configured
8. **Limits / branch** — `enforceAccess()` when `limitType` or `branchId` is set
9. **Handler** — receives typed context

### Handler context

```typescript
interface BusinessApiHandlerContext<TParams> {
  request: NextRequest;
  params: TParams;
  body: unknown | null;
  businessId: string;   // session-scoped tenant
  userId: string;
  subscription: BusinessSubscription;
}
```

### Options

| Option | Required | Description |
|--------|----------|-------------|
| `module` | yes | RBAC module key |
| `action` | yes | RBAC action |
| `claimedBusinessId` | no | String or resolver; validated against JWT |
| `parseJsonBody` | no | Parse body once for POST/PATCH |
| `feature` | no | Feature registry key |
| `report` | no | `basic` \| `gst` \| `advanced` (mutually exclusive with `feature`) |
| `limitType` | no | Plan limit check via `enforceAccess` |
| `branchId` | no | Branch permission check |
| `branchPermission` | no | `view` or `create_transactions` (default: latter) |
| `authContext` | no | Extra `authorize()` context (resourceId, warehouseId, …) |

### Usage — GET with path tenant id

```typescript
import { withBusinessApi } from '@/lib/security';

export const GET = withBusinessApi<{ id: string }>(
  {
    module: 'settings',
    action: 'read',
    claimedBusinessId: ({ params }) => params.id,
  },
  async ({ businessId }) => {
    // SQL must use businessId from context, not raw params
    return NextResponse.json({ ok: true });
  },
);
```

### Usage — POST with body tenant + feature + limit

```typescript
export const POST = withBusinessApi(
  {
    module: 'items',
    action: 'create',
    parseJsonBody: true,
    claimedBusinessId: ({ body }) =>
      (body as { business_id?: string })?.business_id ?? null,
    feature: 'inventory_items',
    limitType: 'items',
  },
  async ({ body, businessId, userId, subscription }) => {
    // handler logic
    return NextResponse.json({ created: true });
  },
);
```

### Usage — GST report route

```typescript
export const GET = withBusinessApi(
  {
    module: 'report.gst',
    action: 'read',
    claimedBusinessId: ({ request }) =>
      new URL(request.url).searchParams.get('business_id'),
    report: 'gst',
  },
  async ({ businessId, userId, request }) => {
    const period = new URL(request.url).searchParams.get('filing_period');
    return NextResponse.json({ businessId, period });
  },
);
```

More patterns: `lib/security/examples.ts`.

---

## Relationship to existing helpers

```
Request
  │
  ├─ requireTenantBusinessId     ← lib/auth-helpers.ts (JWT tenant)
  ├─ getUserIdFromRequest        ← lib/auth-helpers.ts
  │
  ├─ requireOperationalSubscription  ← NEW (subscription + suspend)
  │
  ├─ authorize                   ← lib/authorization.ts (RBAC + session version)
  ├─ assertFeatureAccess         ← lib/subscription/feature-access.ts
  ├─ assertReportAccess          ← lib/subscription/feature-access.ts
  └─ enforceAccess               ← lib/enforce-access.ts (limits + branch)
```

`withBusinessApi` orchestrates these; it does **not** change their internal rules.

When `limitType` or `branchId` is set, `enforceAccess` re-validates subscription and session — intentional overlap keeps behavior identical to current manual call order.

---

## Migration checklist (per route)

1. Identify `module`, `action`, optional `feature` / `report` / `limitType`.
2. Map how the route reads `business_id` (path, query, body) → `claimedBusinessId`.
3. Replace manual guard block with `withBusinessApi`, or insert `requireOperationalSubscription` if keeping a custom handler.
4. Scope all SQL to `ctx.businessId`, never raw client input.
5. Remove duplicated guard code once tests pass.

**Do not migrate cron routes** — use `assertCronAuthorized` from `lib/cron-auth.ts`.

---

## Backward compatibility

- New files only under `lib/security/`; no existing route imports changed.
- Helpers compose existing `lib/auth-helpers`, `lib/authorization`, `lib/enforce-access`, and `lib/subscription/*` modules.
- Legacy `business_id` query/body fallbacks in `getBusinessIdFromRequest` remain available for unmigrated routes.

---

## Verification

```bash
npx tsc --noEmit
```

Confirm no type errors in `lib/security/**`.

Smoke-test after migrating a route:

1. Unauthenticated → 401
2. Cross-tenant `business_id` → 403
3. Expired / suspended subscription → 403 with `code`
4. Missing RBAC permission → 403
5. Missing plan feature → 403 `FEATURE_NOT_IN_PLAN`
6. Valid session + own tenant → handler runs

---

## Files

| File | Role |
|------|------|
| `lib/security/types.ts` | Type definitions |
| `lib/security/require-operational-subscription.ts` | Subscription primitive |
| `lib/security/with-business-api.ts` | Route wrapper |
| `lib/security/index.ts` | Public exports |
| `lib/security/examples.ts` | Reference patterns |
| `docs/SECURITY_FOUNDATION.md` | This document |
