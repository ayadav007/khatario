# Plan Enforcement Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the server enforce the plan limits and features that the audit found enforced only in the browser, on one route, or not at all: findings SUB-08, 09, 12, 18, 20, 21, 22 and 23.

**Architecture:** No new mechanism. Each gap is closed with the helpers the codebase already uses: `authorize()` for permission plus plan-feature path gate, `assertFeatureAccess` for a named feature, `checkLimit` / `checkLimitInTransaction` for limits, and the limit registry for a new limit type. The one central change is that `authorize()` takes the business from the signed session before falling back to the user's stored business.

**Tech Stack:** Next.js route handlers (TypeScript), PostgreSQL through `lib/db.ts`, Jest with real-database suites on `kh_phase2_test`.

**Spec:** `docs/qa/subscription-billing-audit-2026-11-26.md`, section D, the finding ids named in each task.

**Not in this plan:**
- Free plan "phone app only" (SUB-19): the phone app is a web shell on the same session, so the server cannot tell it from a browser without a signed device marker. Needs a design decision.
- What happens to extra users and branches after a downgrade (SUB-24): owner decision.
- Making every count-then-insert limit atomic (SUB-25): only the limits touched here are made atomic.

## Global Constraints

- Tests and migrations run only on the local disposable database `kh_phase2_test`. Migration files are written, never applied to staging or production.
- Database suites follow the header of `tests/db/billing-money-path.db.test.ts` (opt-in through `PHASE2_TEST_DATABASE_URL`, `describe.skip` otherwise, businesses created with `randomUUID()` and deleted in `afterAll`, `@/lib/platform-email` mocked, a `fetch` tripwire). New tests go in `tests/db/plan-enforcement.db.test.ts`.
- Run with `PHASE2_TEST_DATABASE_URL=postgresql://postgres:<local password>@127.0.0.1:5433/kh_phase2_test DB_SSL=false npx jest <file> --runInBand --forceExit`.
- Route tests call the exported handler with a `NextRequest` carrying the trusted headers middleware sets: `x-authenticated-user-id`, `x-authenticated-business-id`, `x-authenticated-session-version`, and `x-khatario-pathname` where the path gate matters.
- Never trust a client-sent `business_id`, `user_id` or `created_by`.
- A plan-limit refusal uses the existing standard reply (`lib/subscription/limit-response.ts`, code `SUBSCRIPTION_LIMIT_EXCEEDED`); a missing feature uses `FeatureAccessDeniedError.toNextResponse()` (code `FEATURE_NOT_IN_PLAN`, HTTP 403).
- No rule may read a plan's price to decide what it includes.
- Existing data is never deleted or deactivated by a limit; a limit only refuses the new write.
- Stage files by name; the controller commits after each task's review.

## Review Focus

1. **A business exactly at its limit**: the write that would exceed it is refused, and an edit that does not add to the count (rename a user, change a role of a user who already holds a seat) still works. Pinned in Tasks 1 and 5.
2. **An owner signed in to two businesses on two devices**: plan checks use the business of the session making the request, never the business last switched to elsewhere. Pinned in Task 3.
3. **Background jobs with no request**: `authorize()` and feature checks called from cron or workers (no session header) keep working. Pinned in Task 3.
4. **A legitimate send on a plan that allows it**: the invoice WhatsApp route still sends for a permitted user under the daily cap. Pinned in Task 2.
5. **A business that downgraded with schedules and campaigns configured**: the job skips them without deleting or disabling the saved configuration, so they resume if the plan returns. Pinned in Task 7.

## File Structure

| File | Responsibility |
| --- | --- |
| `app/api/settings/users/[id]/route.ts`, `app/api/employees/[id]/route.ts` | Seat check when a user gains console access |
| `app/api/invoices/[id]/whatsapp/route.ts` | Permission, plan and daily-cap checks on the invoice send |
| `lib/authorization.ts` | Business for plan checks comes from the session |
| `app/api/businesses/route.ts`, `lib/businesses/provision-business.ts` | One trial per owner |
| `lib/subscription/limit-registry.ts`, e-Way bill create routes | Monthly e-Way bill quota |
| `app/api/leave-types/**`, `app/api/journal-entries/templates/**`, `app/api/stock-requests/**`, `app/api/suppliers/{dashboard,requests,lookup-customer}/**` | Permission and plan gate on routes that had none |
| `lib/hr/recruitment/convert-candidate.ts`, `app/api/employees/[id]/route.ts`, attendance write paths | Employee and attendance limits on every write path |
| `lib/invoices/recurring.ts`, `lib/campaign-processor.ts` | Automation checks the plan at run time |
| `database/migrations/478_hr_plan_structure_limits.sql` | Limit rows HR plans lack |
| `tests/db/plan-enforcement.db.test.ts` | Real-database tests for every task |

---

### Task 1: A user who gains console access needs a free seat (SUB-08)

**Files:**
- Modify: `app/api/settings/users/[id]/route.ts` (PATCH, about lines 200-330), `app/api/employees/[id]/route.ts` (PATCH, the `access_type` and `role_id` writes)
- Test: `tests/db/plan-enforcement.db.test.ts`

**Interfaces:**
- Consumes: `occupiesSeat`-style rule in `lib/subscription/seat-counting.ts` (a user counts when active, not a Connect-only agent, and owner or has `role_id` or is not attendance-only), `checkLimit(businessId, seatLimitType(seat))`, `seatLimitMessage`.
- Produces: in `lib/subscription/seat-counting.ts`, export

```ts
export type SeatFields = { is_active: boolean | null; is_primary_admin: boolean | null; role_id: string | null; access_type: string | null; seat_type?: string | null };
/** True when the user row counts against max_users, by the same rule the count query uses. */
export function userOccupiesConsoleSeat(u: SeatFields): boolean;
```

Both PATCH handlers compute `before = userOccupiesConsoleSeat(existing)` and `after = userOccupiesConsoleSeat(existing merged with the requested changes)`; when `!before && after` they run the seat limit check before writing and refuse with the standard limit reply. The existing checks for a seat move and a reactivation stay.

- [ ] **Step 1: Write the failing tests** (business on `billing_starter`, limit 3 console users, three seats already taken; one attendance-only employee user with no role):

```ts
it('giving a role to an attendance-only user is refused at the seat limit', async () => {
  const res = await patchUser(biz, owner, attendanceOnlyUserId, { role_id: staffRoleId });
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
  expect((await userRow(attendanceOnlyUserId)).role_id).toBeNull();
});
it('renaming a user who already holds a seat still works at the limit', async () => {
  const res = await patchUser(biz, owner, seatedUserId, { name: 'Renamed' });
  expect(res.status).toBe(200);
});
it('changing the role of a seated user still works at the limit', async () => {
  const res = await patchUser(biz, owner, seatedUserId, { role_id: otherRoleId });
  expect(res.status).toBe(200);
});
it('the same role change succeeds when a seat is free', async () => {
  await deactivate(seatedUserId);
  const res = await patchUser(biz, owner, attendanceOnlyUserId, { role_id: staffRoleId });
  expect(res.status).toBe(200);
});
it('switching an employee to full access is refused at the seat limit', async () => {
  const res = await patchEmployee(biz, owner, attendanceOnlyEmployeeId, { access_type: 'full' });
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
});
```

- [ ] **Step 2: Run.** Expected: the first and last FAIL with status 200.
- [ ] **Step 3: Implement `userOccupiesConsoleSeat` and the two checks.** Keep the count query in `seat-counting.ts` and the new function expressing the same rule; add a unit test in `tests/lib/subscription/seat-rule.test.ts` asserting the function agrees with the SQL for the four row shapes used above.
- [ ] **Step 4: Run both test files.** Expected: PASS.

### Task 2: The invoice WhatsApp send is checked like every other send (SUB-09)

**Files:**
- Modify: `app/api/invoices/[id]/whatsapp/route.ts`
- Test: `tests/db/plan-enforcement.db.test.ts`

**Interfaces:**
- Consumes: the checks `app/api/whatsapp/send/route.ts` applies (read it: session, `authorize`, base WhatsApp feature gate, custom-message gate, `checkLimit(businessId, 'whatsapp')`).
- Produces: the invoice route applies, in order: session business and user (401 without); `authorize(userId, 'invoices', 'read', { businessId })`; the same base WhatsApp feature gate as the send route; a `custom_message` is accepted only when the send route would accept a custom message for that business, otherwise the default text is used; `pdf_url` must be an absolute URL whose origin equals `resolvePublicRequestOrigin(request)` or `NEXT_PUBLIC_APP_URL`, otherwise 400 `{ error: 'Invalid document link', code: 'INVALID_PDF_URL' }`; `checkLimit(businessId, 'whatsapp')` with the standard limit reply; then send.

- [ ] **Step 1: Write the failing tests** (`sendWhatsAppMessage` from `@/lib/whatsapp` mocked with `jest.mock`, returning success):

```ts
it('a user without invoice permission cannot send', async () => {
  const res = await sendInvoiceWhatsApp(biz, noPermissionUser, invoiceId, { pdf_url: ownUrl });
  expect(res.status).toBe(403);
  expect(sendWhatsAppMessage).not.toHaveBeenCalled();
});
it('a link to another site is refused', async () => {
  const res = await sendInvoiceWhatsApp(biz, owner, invoiceId, { pdf_url: 'https://evil.example/x.pdf' });
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('INVALID_PDF_URL');
});
it('the daily cap applies', async () => {
  await fillWhatsAppQuota(biz); // insert whatsapp_messages rows for today up to the plan limit
  const res = await sendInvoiceWhatsApp(biz, owner, invoiceId, { pdf_url: ownUrl });
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
});
it('a permitted user under the cap can send', async () => {
  const res = await sendInvoiceWhatsApp(biz, owner, invoiceId, { pdf_url: ownUrl });
  expect(res.status).toBe(200);
  expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run.** Expected: the first three FAIL (200).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.

### Task 3: Plan checks use the session's business; one trial per owner (SUB-12)

**Files:**
- Modify: `lib/authorization.ts:160-230`, `app/api/businesses/route.ts:60-100`, `lib/businesses/provision-business.ts` (the additional-business path)
- Test: `tests/db/plan-enforcement.db.test.ts`, `tests/lib/authorization-business-context.test.ts`

**Interfaces:**
- Produces, in `lib/authorization.ts`: a private `resolveBusinessForPlanChecks(context, callingUser)` returning, in order: `context.businessId`; the `x-authenticated-business-id` request header read through `next/headers` inside try/catch (absent outside a request); `callingUser.business_id`. All three places that used `context?.businessId || callingUser?.business_id` call it. When the header business differs from `callingUser.business_id`, membership is required exactly as the existing cross-business rule requires it (`user_businesses` row); without membership it throws the existing authorization error.
- `POST /api/businesses`: the `multi_business` feature is checked on the session business (`requireTenantBusinessId`), not on `users.business_id`.
- Additional business provisioning: the new business starts on the product's free plan (`getPostTrialFreePlanId(productLine)`, status `active`, no trial dates) when the owner already owns any other business; a brand-new account's first business keeps the 30-day trial. The decision is made by a new exported `ownerHasOtherBusiness(client, userId): Promise<boolean>` in `lib/businesses/provision-business.ts` (a `user_businesses` row with role `owner` for any business).

- [ ] **Step 1: Write the failing tests**

```ts
it('a session on the Free business is judged on the Free business even after switching elsewhere', async () => {
  // owner owns freeBiz (plan free) and paidBiz (billing_business); users.business_id points at paidBiz
  await query(`UPDATE users SET business_id = $1 WHERE id = $2`, [paidBiz, owner]);
  const res = await getLedger(freeBiz, owner); // GET /api/ledger with freeBiz session headers and x-khatario-pathname '/api/ledger'
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe('FEATURE_NOT_IN_PLAN');
});
it('the paid business is not refused while the stored pointer is on the Free one', async () => {
  await query(`UPDATE users SET business_id = $1 WHERE id = $2`, [freeBiz, owner]);
  const res = await getLedger(paidBiz, owner);
  expect(res.status).toBe(200);
});
it('authorize works with no request (cron)', async () => {
  await expect(authorize(owner, 'invoices', 'read', { businessId: paidBiz })).resolves.toBeDefined();
});
it('a second business starts on Free, not on a new trial', async () => {
  const res = await createBusiness(trialBiz, owner, { name: 'Second shop' });
  expect(res.status).toBe(201);
  const id = (await res.json()).business.id;
  expect(await moduleRow(id, 'billing')).toMatchObject({ plan_id: 'free', status: 'active', trial_end_date: null });
});
it('multi-business is checked on the session business', async () => {
  await query(`UPDATE users SET business_id = $1 WHERE id = $2`, [paidBiz, owner]);
  const res = await createBusiness(freeBiz, owner, { name: 'Third shop' });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run.** Expected: tests 1, 2, 4 and 5 FAIL.
- [ ] **Step 3: Implement.** Keep every existing explicit `context.businessId` caller unchanged.
- [ ] **Step 4: Run, plus `npx jest tests/security --forceExit`.** Expected: PASS; any security suite that mocked `authorize`'s business fallback is adjusted only where it asserted the old fallback, and each change is listed in the report.

### Task 4: Monthly e-Way bill quota (SUB-18)

**Files:**
- Modify: `lib/subscription/limit-registry.ts`, `lib/subscription/module-entitlements.ts` (`LIMIT_OWNER_MODULE`), the routes that create an e-Way bill (`app/api/eway-bills/**` and the invoice e-Way route; find them with `grep -rln "eway" app/api lib/gst`)
- Test: `tests/db/plan-enforcement.db.test.ts`

**Interfaces:**
- Produces: limit type `'eway_bills'` with key `max_eway_bills_per_month`, owner module `billing`, counted as e-Way bills created in the current calendar month for the business (`created_at`, never a client-supplied date), not counting cancelled-before-generation drafts if the table has such a state. Every create path checks it in the same transaction as the insert with `checkLimitInTransaction` where the route already has a transaction, else `checkLimit`.
- Seeded values (already in the catalogue): Free 0, Starter 10, Growth 25, Business unlimited.

- [ ] **Step 1: Write the failing tests** (Starter business; insert 10 e-Way bill rows dated this month directly):

```ts
it('the 11th e-Way bill in a month is refused on Starter', async () => {
  const res = await createEwayBill(biz, owner, validPayload);
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
});
it('last month does not count', async () => {
  await query(`UPDATE <eway table> SET created_at = created_at - INTERVAL '40 days' WHERE business_id = $1`, [biz]);
  const res = await createEwayBill(biz, owner, validPayload);
  expect(res.status).toBeLessThan(300);
});
it('Business plan is unlimited', async () => {
  await setPlan(biz, 'billing', 'billing_business');
  const res = await createEwayBill(biz, owner, validPayload);
  expect(res.status).toBeLessThan(300);
});
it('check-limit reports the quota', async () => {
  expect(await checkLimit(biz, 'eway_bills')).toMatchObject({ limit: 10, current: 10, allowed: false });
});
```

- [ ] **Step 2: Run.** Expected: FAIL (type not in registry; create succeeds).
- [ ] **Step 3: Implement.** Add `'eway_bills'` wherever the registry lists limit types (count query, key maps, labels in `lib/subscription/usage-labels.ts` if that file lists types).
- [ ] **Step 4: Run, plus `npx jest tests/lib/resolve-plan-limit.test.ts tests/lib/subscription`.** Expected: PASS.

### Task 5: Employee and attendance limits on every write path; HR structure limits (SUB-22, SUB-23)

**Files:**
- Modify: `lib/hr/recruitment/convert-candidate.ts`, `app/api/employees/[id]/route.ts` (reactivation), `lib/hr/attendance-punch.ts`, `app/api/employees/attendance/face-recognition/route.ts`, `lib/hr/attendance-regularization.ts`, `lib/subscription/limit-registry.ts` (attendance and payroll count queries)
- Create: `database/migrations/478_hr_plan_structure_limits.sql`
- Test: `tests/db/plan-enforcement.db.test.ts`

**Interfaces:**
- Candidate conversion and employee reactivation call `checkLimit(businessId, 'employees')` before creating or reactivating and refuse with the standard reply.
- Each attendance insert path listed above calls the attendance limit before inserting a new row for a day (an update to an existing row for that day is not counted). Automatic server-side inserts (`leave-attendance-sync`, `roster-absent`) are not limited: they record facts.
- The attendance and payroll monthly counts use the row's `created_at`, not the client-supplied `date` / `payment_date`.
- Migration 478: for plans `hr_staff_lite`, `hr_starter`, `hr_pro`, `hr_trial` insert `max_holidays`, `max_shifts`, `max_designations`, `max_departments` with value −1 for `hr_pro` and `hr_trial`, and 30 / 10 / 20 / 10 for `hr_starter` and `hr_staff_lite`, using `INSERT … ON CONFLICT (plan_id, limit_key) DO NOTHING` and only for keys that exist in `platform_limits`.

- [ ] **Step 1: Write the failing tests** (HR business on `hr_staff_lite`, 30 active employees):

```ts
it('converting a candidate is refused at the employee limit', async () => {
  const res = await convertCandidate(biz, owner, candidateId);
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
});
it('reactivating an employee is refused at the limit', async () => {
  const res = await patchEmployee(biz, owner, inactiveEmployeeId, { is_active: true });
  expect(res.status).toBe(403);
});
it('editing an active employee still works at the limit', async () => {
  const res = await patchEmployee(biz, owner, activeEmployeeId, { designation: 'Senior' });
  expect(res.status).toBe(200);
});
it('a backdated attendance row still counts this month', async () => {
  await insertAttendance(biz, employeeId, { date: '2020-01-01' }); // created now
  expect((await checkLimit(biz, 'attendance')).current).toBe(1);
});
it('migration 478 gives HR Pro unlimited shifts', async () => {
  await query(readFileSync('database/migrations/478_hr_plan_structure_limits.sql', 'utf8'));
  await setPlan(biz, 'hr', 'hr_pro');
  expect((await checkLimit(biz, 'shifts')).limit).toBe(-1);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Run migration 478's SQL only as text inside the test.

### Task 6: Routes on gated features get a permission and plan check (SUB-21)

**Files:**
- Modify: `app/api/leave-types/route.ts`, `app/api/leave-types/[id]/route.ts`, `app/api/journal-entries/templates/route.ts`, `app/api/journal-entries/templates/[id]/route.ts`, all eight `app/api/stock-requests/**/route.ts`, `app/api/suppliers/dashboard/route.ts`, `app/api/suppliers/dashboard/analytics/route.ts`, `app/api/suppliers/requests/route.ts`, `app/api/suppliers/lookup-customer/route.ts`
- Test: `tests/db/plan-enforcement.db.test.ts`

**Interfaces:**
- Each handler, after its existing session check, calls `authorize(userId, <module>, <action>, { businessId })` with the module and action its sibling routes use (leave types: the module the leave-request routes use, `read` for GET, `update`/`create`/`delete` for writes; journal templates: the module `app/api/journal-entries/route.ts` uses; stock requests and supplier hub: the module `app/api/suppliers/route.ts` uses) and maps `AuthorizationError` with `toNextResponse()`. Where the feature is not covered by the path gate for that URL, the handler also calls `assertFeatureAccess(businessId, <feature>)`: `hr_leaves` for leave types, `advanced_ledger` for journal templates, `purchase_supplier_hub` for stock requests and the hub dashboards.

- [ ] **Step 1: Write the failing tests** (table-driven):

```ts
const cases = [
  ['POST', '/api/leave-types', leaveTypesPOST, { leave_name: 'X', leave_code: 'X' }, 'free HR'],
  ['POST', '/api/journal-entries/templates', journalTemplatesPOST, balancedTemplate, 'billing_starter'],
  ['POST', '/api/stock-requests', stockRequestsPOST, stockRequestPayload, 'free'],
  ['GET', '/api/suppliers/dashboard', suppliersDashboardGET, undefined, 'free'],
] as const;
it.each(cases)('%s %s is refused on a plan without the feature', async (_m, path, handler, body) => {
  const res = await call(handler, lowPlanBiz, owner, path, body);
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe('FEATURE_NOT_IN_PLAN');
});
it.each(cases)('%s %s is refused for a user without permission', async (_m, path, handler, body) => {
  const res = await call(handler, fullPlanBiz, noPermissionUser, path, body);
  expect(res.status).toBe(403);
});
it.each(cases)('%s %s works for the owner on a plan with the feature', async (_m, path, handler, body) => {
  const res = await call(handler, fullPlanBiz, fullPlanOwner, path, body);
  expect(res.status).toBeLessThan(300);
});
```

- [ ] **Step 2: Run.** Expected: the first two groups FAIL.
- [ ] **Step 3: Implement** the remaining routes in the Files list the same way; add each to the table.
- [ ] **Step 4: Run.** Expected: PASS.

### Task 7: Automation checks the plan when it runs (SUB-20)

**Files:**
- Modify: `lib/invoices/recurring.ts` (the per-schedule run loop), `lib/campaign-processor.ts:60-120`
- Test: `tests/db/plan-enforcement.db.test.ts`

**Interfaces:**
- Recurring invoices: before generating for a schedule, `hasFeatureAccess(businessId, 'sales_recurring_invoices')`; when false the schedule is skipped for this run, left unchanged (not paused, next-run date not advanced), and counted in a new `skippedNoPlan` field of the run result.
- Campaigns: before sending a batch, the business must pass the same Connect gate the campaign API uses (`assertWhatsAppPremiumAddon` or its boolean form) and `checkLimit(businessId, 'whatsapp')`; when either fails the campaign stays in its current state and no message is sent; the processor records the reason on the campaign row only if a suitable column already exists (do not add a column).

- [ ] **Step 1: Write the failing tests**

```ts
it('a due schedule is skipped after the plan drops below Growth and resumes when it returns', async () => {
  const sched = await makeDueSchedule(biz);            // plan billing_growth
  await setPlan(biz, 'billing', 'billing_starter');
  const r1 = await runRecurringInvoices();
  expect(r1.skippedNoPlan).toBeGreaterThanOrEqual(1);
  expect(await count(`invoices WHERE business_id = $1`, [biz])).toBe(0);
  expect((await scheduleRow(sched)).next_run_date).toBe(originalNextRun);
  await setPlan(biz, 'billing', 'billing_growth');
  await runRecurringInvoices();
  expect(await count(`invoices WHERE business_id = $1`, [biz])).toBe(1);
});
it('a campaign does not send after Connect lapses', async () => {
  const campaign = await makeScheduledCampaign(biz);   // Connect active
  await setPlan(biz, 'connect', 'connect_free');
  await processCampaigns();
  expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  expect((await campaignRow(campaign)).status).not.toBe('completed');
});
it('a campaign stops at the daily WhatsApp cap', async () => {
  const campaign = await makeScheduledCampaign(biz);
  await fillWhatsAppQuota(biz);
  await processCampaigns();
  expect(sendWhatsAppMessage).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole `plan-enforcement` file, `tests/db/billing-money-path.db.test.ts`, `npx jest tests/security tests/lib/subscription --forceExit`, and `npx tsc --noEmit`.** Expected: PASS, no type errors.

---

## After the last task

- Migration 478 needs owner approval before staging.
- Staging checks as a Starter owner: assign a role to a fourth user (refused); `POST /api/invoices/{id}/whatsapp` as a staff user without invoice permission (403).
- Append the project log entry and update the audit report's status table.

## Owner decisions inside this plan

| Task | Decision taken here | Alternative |
| --- | --- | --- |
| 3 | A second or later business of the same owner starts on Free; only an account's first business gets the 30-day trial. | Give each new business a trial but cap the number of businesses. |
| 5 | HR Lite and HR Starter get 30 holidays, 10 shifts, 20 designations, 10 departments; HR Pro and the HR trial are unlimited. | Other numbers. |
| 5 | Attendance and payroll monthly quotas count rows by when they were entered, so backdating no longer avoids them. | Keep counting by the record's own date. |
| 7 | A schedule or campaign that cannot run on the current plan is skipped silently and resumes if the plan returns. | Pause it and notify the owner. |
