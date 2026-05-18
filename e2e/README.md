# E2E Tests (Playwright)

## Setup

1. Add test credentials to `.env.local` (or export before running):

   ```
   E2E_TEST_PHONE=your_primary_admin_phone
   E2E_TEST_PASSWORD=your_primary_admin_password
   ```

2. Ensure the app and database are running (dev server starts automatically when running tests).

## Run

```bash
# Run all E2E tests
npm run test:e2e

# Run with UI (interactive)
npm run test:e2e:ui

# Run specific file
npx playwright test e2e/smoke.spec.ts

# Run in headed mode (see browser)
npx playwright test --headed
```

## Tests

- **smoke.spec.ts** – Login + main routes (dashboard, invoices, customers, items, settings). Asserts no "Access Denied".
- **offline.spec.ts** – Offline auth guard. Primary admin can open create pages when offline (after caching permissions online first).
