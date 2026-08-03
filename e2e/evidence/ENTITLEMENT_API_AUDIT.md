# Platform API Entitlement Audit

Generated during entitlement enforcement fix (2026-06-23).

Legend:
- **Module gate** = `requirePlatformModule` / `assertModuleAccess`
- **Feature gate** = `assertFeatureAccess` / `enforceAccess`
- **RBAC only** = `authorize()` without subscription module check

## Billing module (`billing`)

| API | Method | Required entitlement | Protection after fix | Risk |
|-----|--------|---------------------|----------------------|------|
| `/api/invoices` | GET | billing module | Module gate + RBAC | Low |
| `/api/invoices` | POST | billing + feature | enforceAccess | Low |
| `/api/customers` | GET | billing module | Module gate + RBAC | Low |
| `/api/customers` | POST | billing + feature | enforceAccess | Low |
| `/api/items` | GET | billing module | Module gate + RBAC | Low |
| `/api/items` | POST | billing + limits | RBAC (add module gate on POST follow-up) | Medium |
| `/api/purchases` | GET | billing module | Module gate + RBAC | Low |
| `/api/purchases` | POST | billing + feature | enforceAccess | Low |
| `/api/dashboard/*` | GET | billing module | **RBAC only** — follow-up | Medium |
| `/api/reports/*` | GET | billing module | **RBAC only** — follow-up | Medium |

## HR module (`hr`)

| API | Method | Required entitlement | Protection | Risk |
|-----|--------|---------------------|------------|------|
| `/api/employees` | GET/POST | hr + hr_* feature | authorize → assertFeatureAccess | Low |
| `/api/hr/*` | * | hr module | module + feature checks | Low |

## Connect module (`connect`)

| API | Method | Required entitlement | Protection | Risk |
|-----|--------|---------------------|------------|------|
| `/api/whatsapp/*` | * | connect + addons | whatsapp-api-gates | Low |

## Module / subscription

| API | Method | Required entitlement | Protection after fix | Risk |
|-----|--------|---------------------|----------------------|------|
| `/api/modules` | POST | paid/trial checkout | **403 MODULE_REQUIRES_CHECKOUT** | Low |
| `/api/subscriptions/current` | POST | admin/checkout | **403 SUBSCRIPTION_ASSIGNMENT_FORBIDDEN** | Low |
| `/api/subscriptions/checkout` | POST | valid plan | Razorpay + webhook | Low |
| `/api/subscriptions/upgrade` | POST | ₹0 plans only | amount check + applyModule | Low |

## Remaining follow-up (not in this PR scope)

- Add `requirePlatformModule('billing')` to dashboard and reports GET routes.
- Add module gate to billing POST routes that only use RBAC today (items POST).
- Staging test with Razorpay configured for paid module add + addon checkout redirect.
