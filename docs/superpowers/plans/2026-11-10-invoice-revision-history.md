# Invoice Revision History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every change to an invoice (create, draft edit, finalize, amend, cancel, payment, credit note, e-way bill, GSTR-1 lock, restore, store order) leaves a permanent, versioned entry in that invoice's History: who, when, what action, optional reason, and the before/after of every changed field and line.

**Architecture:** The database captures history, not the routes. Commit-time (deferred constraint) triggers on `invoices`, `invoice_items` and `invoice_charges` call one function that snapshots the invoice (header + lines + charges) into an append-only `invoice_revisions` table, once per transaction, and only when the snapshot differs from the last one. Routes add *context* only (actor, action, reason) through transaction-local `set_config`; a path that forgets still gets recorded, shown as "System". Diffs are computed in TypeScript when History is read, by comparing each revision with the one before it.

**Tech Stack:** PostgreSQL (plpgsql, constraint triggers, jsonb), Next.js route handlers, `pg` PoolClient, Jest (`tests/db/*.db.test.ts` on `kh_phase2_test`), React (`components/invoices/InvoiceDetailPanel.tsx`).

**Spec:** this plan; the decision is recorded in `docs/project.log.md` (2026-11-10 entry "Invoice history plan"). Background: TallyPrime Edit Log (MCA audit-trail rule, 1 April 2023) records every create/alter/delete with user, time and earlier versions, and cannot be switched off.

## Why triggers, not one call per route

26 files write `invoices` / `invoice_items` (see Task 3's list). A per-route `recordRevision()` call would miss the next new path; an audit trail that misses changes is worse than none. Triggers catch every write, including SQL from admin scripts. The precedent is in the repo: `validate_voucher_balance_trigger` (migration 123) is a deferred constraint trigger, and `lib/accounting/ledger-delete-guard.ts` passes context with `set_config(..., true)`.

## Global Constraints

- Migration number is **469**. If 469 exists when you start, use the next free number and rename everywhere.
- Never run a migration against staging or production. DB tests apply the migration themselves on `kh_phase2_test` (localhost) and refuse any other database, as `tests/db/invoice-amend-fields.db.test.ts` does.
- Migration must be safe to run twice (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`), header comment in the style of `468_customer_receivable_accounts.sql`.
- Context settings use their own keys: `khatario.invoice_actor_id`, `khatario.invoice_action`, `khatario.invoice_reason`. Do **not** reuse `khatario.actor_id`: `withLedgerDelete` resets it to `''` in its `finally`, which would wipe the actor mid-transaction.
- `invoice_revisions` rows are never updated. Deletes are refused unless `current_setting('khatario.ledger_delete_reason', true)` is `'tenant_purge'` or `'admin:purge_invoices'` (the two existing purge paths, which already set it via `withLedgerDelete`).
- If `invoices` has row-level security enabled when you start (see `docs/superpowers/plans/2026-11-05-row-level-security.md`), enable it on `invoice_revisions` with the same business policy, and add a DB test that another business's session reads no rows.
- Never trust client-sent `user_id` / `business_id`: actor comes from `getAuthenticatedUserId(request)`, business from `getSessionScopedBusinessId(request)`.
- `reason` is optional everywhere, trimmed, max 500 characters; longer → 400 `{ code: 'REASON_TOO_LONG' }`.
- User-facing copy: plain English, no jargon. Baseline revisions read "Recorded when history started".
- Stage files by name. Commit only when the user asks.

## Review Focus

1. **Customer opens the public invoice link** (`record-view.ts` bumps `view_count`, `last_viewed_at`, `first_viewed_at`; `public-token.ts` sets `public_token`) → must create **no** revision. Test in Task 1.
2. **Draft edit deletes and re-inserts every line** (`app/api/invoices/route.ts:1849`) → new line row ids must not show as "all lines removed, all lines added"; lines are matched by `sort_order`, then position. Test in Task 2.
3. **One save touches the invoice row many times** (insert, items, charges, balance recompute, ledger, payment) → exactly **one** revision per transaction. Test in Task 1.
4. **Rolled-back save** (e.g., amend refused after `BEGIN`) → no revision. Test in Task 1.
5. **Bulk GSTR-1 mark-filed** sets `is_editable = false` on many invoices in one statement → one revision per invoice, action `gstr1_locked`, and the request still completes in reasonable time for 500 invoices. Test in Task 3.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `database/migrations/469_invoice_revisions.sql` (create) | Table, snapshot + capture functions, deferred triggers, immutability guard, baseline backfill |
| `lib/invoices/invoice-audit-context.ts` (create) | `setInvoiceAuditContext()` and the `InvoiceAuditAction` union |
| `lib/invoices/invoice-revision-diff.ts` (create) | Pure diff of two snapshots, field labels, one-line description |
| `lib/invoices/invoice-history.ts` (create) | Read revisions + legacy activity rows for one invoice, build history entries |
| `app/api/invoices/[id]/history/route.ts` (modify) | Return the new history entries |
| `app/api/invoices/[id]/history/[revision]/route.ts` (create) | Return one revision's full snapshot |
| 21 writer files (modify, Task 3) | Call `setInvoiceAuditContext` inside their transaction |
| `components/invoices/InvoiceHistoryTimeline.tsx` (create) | History tab body: entries, changes, reason, "View this version" |
| `components/invoices/InvoiceDetailPanel.tsx` (modify) | Use the timeline component |
| `app/(app)/invoices/new/page.tsx` (modify ~line 2002) | Optional "Reason for change" in the amend flow |
| `types/database.ts` (modify) | `InvoiceRevision` row type |
| Tests | `tests/db/invoice-revisions.db.test.ts`, `tests/lib/invoices/invoice-revision-diff.test.ts`, `tests/lib/invoices/invoice-audit-coverage.test.ts`, `tests/db/invoice-history-api.db.test.ts` |

---

### Task 1: Revision table and capture triggers (migration 469)

**Files:**
- Create: `database/migrations/469_invoice_revisions.sql`
- Modify: `types/database.ts` (add `InvoiceRevision`)
- Test: `tests/db/invoice-revisions.db.test.ts`

**Interfaces:**
- Produces (SQL):
  - Table `invoice_revisions(id UUID PK DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, revision_no INT NOT NULL, tx_id BIGINT NOT NULL, action VARCHAR(40) NOT NULL, reason TEXT, actor_user_id UUID, actor_name TEXT, snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`, `UNIQUE (invoice_id, revision_no)`, `UNIQUE (invoice_id, tx_id)`, index `(business_id, invoice_id, revision_no DESC)`. `actor_user_id` has **no** FK (a user delete must not touch audit rows); `actor_name` is copied from `users.name` at capture time.
  - `invoice_snapshot(p_invoice_id UUID) RETURNS JSONB` → `{"header": <to_jsonb(invoices row) minus updated_at, view_count, last_viewed_at, first_viewed_at, public_token>, "lines": [<invoice_items rows minus id, invoice_id, ordered by sort_order, id>], "charges": [<invoice_charges rows minus id, invoice_id, business_id, ordered by sort_order, id>]}`; NULL when the invoice row does not exist.
  - `capture_invoice_revision(p_invoice_id UUID) RETURNS VOID`: returns early if a row exists for `(p_invoice_id, txid_current())` or the snapshot is NULL or equals the latest revision's snapshot; otherwise inserts `revision_no = COALESCE(max,0)+1`, `action = COALESCE(NULLIF(current_setting('khatario.invoice_action', true), ''), CASE WHEN no earlier revision THEN 'created' ELSE 'updated' END)`, reason and actor from the other two settings (actor cast to UUID only when it matches the UUID pattern, else NULL).
  - Constraint triggers `DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`: `trg_invoice_revision_header` AFTER INSERT OR UPDATE ON `invoices`; `trg_invoice_revision_items` AFTER INSERT OR UPDATE OR DELETE ON `invoice_items`; `trg_invoice_revision_charges` same on `invoice_charges`. Each calls `capture_invoice_revision(COALESCE(NEW.invoice_id/id, OLD.invoice_id))`.
  - Guard: BEFORE UPDATE OR DELETE trigger on `invoice_revisions` raising `invoice history cannot be changed` (SQLSTATE `P0001`), allowing DELETE only under the two purge reasons; BEFORE TRUNCATE statement trigger that always raises.
  - Backfill: `INSERT INTO invoice_revisions (...) SELECT ... 1, 0, 'baseline', NULL, NULL, NULL, invoice_snapshot(i.id), now() FROM invoices i WHERE NOT EXISTS (revision for i.id)` (runs before the triggers are created; `tx_id` 0 is fine because uniqueness is per invoice).
- Produces (TS): `export interface InvoiceRevision { id: string; business_id: string; invoice_id: string; revision_no: number; action: string; reason: string | null; actor_user_id: string | null; actor_name: string | null; snapshot: InvoiceSnapshot; created_at: string }` with `InvoiceSnapshot` imported from Task 2's module (define the type in Task 2's file; if Task 1 lands first, put `InvoiceSnapshot` in `types/database.ts` and have Task 2 re-export it).

- [ ] **Step 1: Write the failing test** `tests/db/invoice-revisions.db.test.ts`. Copy the env/disposable-DB guard, mocks and `afterAll` purge from `tests/db/invoice-amend-fields.db.test.ts`. `beforeAll` runs the migration file twice through `pool.query(fs.readFileSync(...))`, then creates business `B`, branch, user `USER` named `'Owner'`, customer. Helper `tx(fn)` runs `fn(client)` inside BEGIN/COMMIT. Tests:
  - `insert creates revision 1 'created' with lines`: in one tx insert invoice `INV` (draft) + 2 `invoice_items` (sort_order 0, 1) → `SELECT * FROM invoice_revisions WHERE invoice_id = INV` has 1 row, `revision_no = 1`, `action = 'created'`, `snapshot->'lines'` length 2.
  - `one transaction with many writes makes one revision`: tx updates `notes`, deletes and re-inserts both items, updates `grand_total` → revision count goes from 1 to 2.
  - `context is recorded`: tx runs `SELECT set_config('khatario.invoice_actor_id', USER, true), set_config('khatario.invoice_action', 'amended', true), set_config('khatario.invoice_reason', 'Wrong PO', true)` then updates `purchase_order_number` → latest row has `action 'amended'`, `reason 'Wrong PO'`, `actor_user_id USER`, `actor_name 'Owner'`.
  - `no context → updated, actor null`.
  - `customer view creates no revision`: `UPDATE invoices SET view_count = 1, last_viewed_at = now(), first_viewed_at = now(), public_token = 'tok', updated_at = now()` → count unchanged.
  - `rolled back change creates no revision`: BEGIN, update notes, ROLLBACK → count unchanged.
  - `history cannot be edited`: `UPDATE invoice_revisions SET reason = 'x'` rejects with `/invoice history cannot be changed/`; `DELETE` likewise; `TRUNCATE invoice_revisions` rejects.
  - `purge may delete`: in `afterAll`, the existing `withLedgerDelete(client, 'tenant_purge', ...)` business delete succeeds (the test passing proves it).
  - `baseline backfill`: after the migration runs in `beforeAll`, every invoice already in `kh_phase2_test` has a revision: `SELECT count(*) FROM invoices i WHERE NOT EXISTS (SELECT 1 FROM invoice_revisions r WHERE r.invoice_id = i.id)` = 0, and those rows have `action = 'baseline'`.

- [ ] **Step 2: Run to verify it fails**
  Run: `npx jest tests/db/invoice-revisions.db.test.ts --runInBand`
  Expected: FAIL (migration file not found / relation `invoice_revisions` does not exist).

- [ ] **Step 3: Write `database/migrations/469_invoice_revisions.sql`** per the Interfaces block. Order: table + indexes → `invoice_snapshot` → backfill → `capture_invoice_revision` → guard function + triggers → the three capture triggers (`DROP TRIGGER IF EXISTS` first). Header comment explains: why commit-time triggers, which columns are excluded from snapshots and why, the purge exception, and "No existing row is changed. Safe to run more than once." Add `InvoiceRevision` to `types/database.ts`.

- [ ] **Step 4: Run to verify it passes**
  Run: `npx jest tests/db/invoice-revisions.db.test.ts --runInBand`
  Expected: PASS. Then run the existing invoice DB tests to catch trigger side effects: `npx jest tests/db/invoice-amend-fields.db.test.ts tests/db/ledger-delete-guard.db.test.ts --runInBand` → PASS.

- [ ] **Step 5: Commit** (if asked): the migration, `types/database.ts`, the test file.

---

### Task 2: Snapshot diff library

**Files:**
- Create: `lib/invoices/invoice-revision-diff.ts`
- Test: `tests/lib/invoices/invoice-revision-diff.test.ts`

**Interfaces:**
- Produces:
  - `export interface InvoiceSnapshot { header: Record<string, unknown>; lines: Record<string, unknown>[]; charges: Record<string, unknown>[] }`
  - `export interface FieldChange { field: string; label: string; before: unknown; after: unknown }`
  - `export interface LineChange { kind: 'added' | 'removed' | 'changed'; position: number; name: string; fields: FieldChange[] }`
  - `export interface InvoiceDiff { header: FieldChange[]; lines: LineChange[]; charges: LineChange[] }`
  - `export function diffInvoiceSnapshots(prev: InvoiceSnapshot | null, next: InvoiceSnapshot): InvoiceDiff` — `prev === null` returns an empty diff (first or baseline revision).
  - `export function fieldLabel(field: string): string` — from `INVOICE_FIELD_LABELS`, else `snake_case` → "Sentence case".
  - `export function describeRevision(action: string, diff: InvoiceDiff, invoiceNumber: string): string`
  - `export const INVOICE_ACTION_LABELS: Record<string, string>`

Rules the tests pin:
- Header keys compared after normalising: numbers and numeric strings compare by value (`'100.00'` equals `100`), `null` equals `''` equals missing, dates compare on the first 10 characters when both look like `YYYY-MM-DD…`.
- Ignored header keys (system bookkeeping, never shown): `id`, `business_id`, `created_at`, `created_by`, `search_vector`, `is_editable` is **shown** (label "Locked for editing").
- Lines and charges are paired by `sort_order`; ties and missing `sort_order` pair by position. `name` is `item_name` (charges: `purpose`). Ignored line keys: `id`, `invoice_id`.
- Labels include at least: `invoice_date` "Invoice date", `due_date` "Due date", `status` "Status", `grand_total` "Total", `amount_paid` "Amount received", `balance_amount` "Balance due", `customer_id` "Customer", `billing_address` "Billing address", `shipping_address` "Ship-to address", `notes` "Notes", `purchase_order_number` "PO number", `eway_bill_number` "E-way bill number", `place_of_supply_state_code` "Place of supply", line `quantity` "Qty", `unit_price` "Rate", `discount_percent` "Discount %", `tax_rate` "GST %", `line_total` "Amount", plus every field in `AMEND_TEXT_FIELDS` / `AMEND_DATE_FIELDS` in `app/api/invoices/[id]/amend/route.ts` with the same label text.
- `INVOICE_ACTION_LABELS`: `baseline` "Recorded when history started", `created` "Created", `draft_edited` "Draft edited", `finalized` "Finalized", `amended` "Amended", `cancelled` "Cancelled", `payment_recorded` "Payment recorded", `payment_reversed` "Payment reversed", `credit_note_applied` "Credit note applied", `converted` "Converted", `eway_updated` "E-way bill updated", `restored` "Restored", `gstr1_locked` "Locked by GSTR-1 filing", `proforma_status` "Estimate status changed", `store_order` "Online store order", `updated` "Updated".
- `describeRevision('amended', diff with invoice_date + notes, 'INV-7')` → `"Amended INV-7: Invoice date, Notes"`; with no changes → `"Amended INV-7"`; more than 3 changed fields → first 3 then `" and 2 more"`; line changes count as `"Items"` once.

- [ ] **Step 1: Write the failing tests** (one `it` per rule above), e.g.:
```ts
it('pairs re-inserted lines by sort_order, not row id', () => {
  const prev = snap({ lines: [line(0, 'Rice', 2), line(1, 'Dal', 1)] });
  const next = snap({ lines: [line(0, 'Rice', 3), line(1, 'Dal', 1)] }); // new ids
  expect(diffInvoiceSnapshots(prev, next).lines).toEqual([
    { kind: 'changed', position: 0, name: 'Rice', fields: [{ field: 'quantity', label: 'Qty', before: 2, after: 3 }] },
  ]);
});
```
  Other cases: added line, removed line, `'100.00'` vs `100` → no change, `null` vs `''` → no change, `prev = null` → empty diff, unknown field label humanised, `describeRevision` four cases.
- [ ] **Step 2: Run to verify it fails** — `npx jest tests/lib/invoices/invoice-revision-diff.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `lib/invoices/invoice-revision-diff.ts` per the Interfaces block. No DB access, no imports from `app/`.
- [ ] **Step 4: Run to verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** (if asked).

---

### Task 3: Audit context in every invoice writer

**Files:**
- Create: `lib/invoices/invoice-audit-context.ts`
- Create: `tests/lib/invoices/invoice-audit-coverage.test.ts`
- Modify (add the call inside the existing transaction, right after `BEGIN`; wrap in BEGIN/COMMIT where the route has none):

| File | Action | Reason source | Has BEGIN today |
| --- | --- | --- | --- |
| `app/api/invoices/route.ts` (POST) | `created` when no `body.id`, else `draft_edited`; `finalized` when an existing draft is saved as final | `body.change_reason` | yes |
| `app/api/invoices/[id]/route.ts` (PATCH estimate_status) | `proforma_status` | — | **no → wrap** |
| `app/api/invoices/[id]/amend/route.ts` | `amended` | `body.reason` | yes |
| `app/api/invoices/[id]/finalize/route.ts` | `finalized` | — | yes |
| `app/api/invoices/[id]/cancel/route.ts` | `cancelled` | existing `reason` | yes |
| `app/api/invoices/[id]/payments/route.ts` | `payment_recorded` | — | yes |
| `app/api/invoices/[id]/eway/route.ts` | `eway_updated` | — | **no → wrap** |
| `app/api/invoices/[id]/convert-to-tax-invoice/route.ts` | `converted` | — | yes |
| `app/api/invoices/[id]/proforma-lifecycle/route.ts` (POST) | `proforma_status` | — | yes |
| `app/api/invoices/restore/route.ts` | `restored` | — | **no → wrap** |
| `app/api/estimates/[id]/convert/route.ts` | `converted` | — | yes |
| `app/api/payments/route.ts` (POST) | `payment_recorded` | — | yes |
| `lib/accounting/payment-reversal.ts` (`executePaymentReversal`, takes a client) | `payment_reversed` | reversal reason param | caller's |
| `lib/credit-notes/create-credit-note.ts` (`createCreditNoteInTransaction`) | `credit_note_applied` | — | caller's |
| `lib/accounting/advance-service.ts` (`adjustAdvance`, `releaseDocumentAdvances`) | `payment_recorded` / `payment_reversed` | — | caller's |
| `app/api/reports/gst/gstr1/[filingId]/mark-filed/route.ts` | `gstr1_locked` | `'GSTR-1 filed for <period>'` | yes |
| `app/api/stock-transfers/[id]/cancel/route.ts` | `cancelled` | `'Stock transfer cancelled'` | yes |
| `lib/store/fulfill-paid-order.ts`, `lib/store/store-receipt.ts`, `lib/store/store-refund.ts` | `store_order` (actor null) | — | yes |

  Allowlisted (no call; each listed in the coverage test with this reason): `lib/customer-surface/record-view.ts` and `lib/customer-surface/public-token.ts` (columns excluded from snapshots), `lib/invoices/invoice-balance.ts`, `lib/invoices/invoice-charges.ts`, `lib/invoices/invoice-create-service.ts`, `lib/invoices/cancel-final-invoice.ts`, `lib/custom-fields-persist.ts` (helpers that always run inside a caller that sets context).

**Interfaces:**
- Produces:
  - `export type InvoiceAuditAction = 'created' | 'draft_edited' | 'finalized' | 'amended' | 'cancelled' | 'payment_recorded' | 'payment_reversed' | 'credit_note_applied' | 'converted' | 'eway_updated' | 'restored' | 'gstr1_locked' | 'proforma_status' | 'store_order'` (must equal the keys of `INVOICE_ACTION_LABELS` minus `baseline` and `updated`).
  - `export async function setInvoiceAuditContext(client: PoolClient, ctx: { actorUserId: string | null; action: InvoiceAuditAction; reason?: string | null }): Promise<void>` — one `SELECT set_config(...), set_config(...), set_config(...)` with `is_local = true`; reason trimmed and cut at 500 (routes validate length first and return 400).
  - `export function parseChangeReason(value: unknown): string | null | 'too_long'`

- [ ] **Step 1: Write the failing coverage test.** It globs `app/**/*.ts` and `lib/**/*.ts`, keeps files whose text matches `/UPDATE\s+invoices\s|INSERT\s+INTO\s+invoice_items|DELETE\s+FROM\s+invoice_items|INSERT\s+INTO\s+invoices\s/`, and asserts each either contains `setInvoiceAuditContext(` or is in `ALLOWLIST` (a `Record<path, reason>`). It also asserts every `ALLOWLIST` path still exists (stale entries fail). Test name: `every invoice writer sets audit context or is allowlisted with a reason`.
- [ ] **Step 2: Add route-level DB assertions** to `tests/db/invoice-revisions.db.test.ts` (new `describe('route context')`), calling the real handlers the way `invoice-amend-fields.db.test.ts` does:
  - `amend records action, reason and actor`: `PATCH /api/invoices/INV/amend` with `{ invoice_date, notes: 'New', reason: 'Customer asked' }` → latest revision `action 'amended'`, `reason 'Customer asked'`, `actor_user_id USER`.
  - `amend with a 501-character reason` → 400 `REASON_TOO_LONG`, revision count unchanged.
  - `cancel records the cancel reason`: `PATCH .../cancel` `{ reason: 'Duplicate' }` on a second final invoice → `action 'cancelled'`, `reason 'Duplicate'`.
  - `eway update is recorded with actor` (proves the new transaction wrap).
  - `GSTR-1 mark-filed locks 500 invoices with one revision each in under 10 s` (Review Focus 5): seed 500 final invoices in one period, call the mark-filed handler, assert 500 new `gstr1_locked` rows and elapsed < 10000 ms.
- [ ] **Step 3: Run to verify both fail** — `npx jest tests/lib/invoices/invoice-audit-coverage.test.ts` → FAIL listing the files; `npx jest tests/db/invoice-revisions.db.test.ts --runInBand` → the new cases FAIL (`action` is `updated`).
- [ ] **Step 4: Implement** `lib/invoices/invoice-audit-context.ts`, then add the call to every file in the table. Amend route: parse `body.reason` with `parseChangeReason` next to the other validations. Where a lib function takes a `client`, add an optional `audit?: { actorUserId: string | null; reason?: string | null }` parameter and set context only when given; its route callers pass it.
- [ ] **Step 5: Run to verify they pass** — both commands → PASS. Then the wider invoice suites: `npx jest tests/db --runInBand -t "invoice"` → no new failures (compare with a run on the unmodified tree if anything fails).
- [ ] **Step 6: Commit** (if asked).

---

### Task 4: History API

**Files:**
- Create: `lib/invoices/invoice-history.ts`
- Modify: `app/api/invoices/[id]/history/route.ts`
- Create: `app/api/invoices/[id]/history/[revision]/route.ts`
- Test: `tests/db/invoice-history-api.db.test.ts`

**Interfaces:**
- Consumes: `diffInvoiceSnapshots`, `describeRevision`, `INVOICE_ACTION_LABELS`, `InvoiceDiff` (Task 2); `invoice_revisions` (Task 1).
- Produces:
  - `export interface InvoiceHistoryEntry { id: string; kind: 'revision' | 'activity'; revision_no: number | null; action: string; action_label: string; description: string; reason: string | null; created_at: string; user_name: string | null; diff: InvoiceDiff | null }`
  - `export async function loadInvoiceHistory(businessId: string, invoiceId: string, limit: number): Promise<InvoiceHistoryEntry[]>` — revisions newest first, each diffed against the previous `revision_no` (fetch `limit + 1` so the oldest shown still has a predecessor); then legacy `activity_logs` rows (`module = 'invoices'`, `entity_id = invoiceId`) whose `created_at` is earlier than the oldest revision, as `kind: 'activity'`, `diff: null`. `user_name` is `actor_name` for revisions (`null` → UI shows "System").
  - `GET /api/invoices/[id]/history` → `{ history: InvoiceHistoryEntry[] }`; same auth as today (`authorize(userId, 'invoices', 'read', ...)`, business from session), `limit` 1–500, default 100.
  - `GET /api/invoices/[id]/history/[revision]` → `{ revision_no, action, action_label, reason, created_at, user_name, snapshot }`; 404 `{ code: 'REVISION_NOT_FOUND' }` when the invoice or revision is not in the session's business.

- [ ] **Step 1: Write the failing test** with the same DB guard. Seed one invoice through the real POST + amend handlers (so revisions exist), plus one `activity_logs` row dated a day before. Assertions:
  - `history lists revisions newest first with diffs`: entries[0] `action 'amended'`, `diff.header` contains `{ field: 'notes', before: 'Old', after: 'New' }`, `user_name 'Owner'`.
  - `oldest revision has no predecessor diff`: last revision entry `diff` has empty arrays.
  - `legacy activity appears after revisions`: final entry `kind 'activity'`.
  - `other business cannot read history`: request with another business's headers → 404.
  - `single revision returns its snapshot`: `GET .../history/1` → `snapshot.lines.length` equals seeded line count; `GET .../history/99` → 404 `REVISION_NOT_FOUND`.
- [ ] **Step 2: Run to verify it fails** — `npx jest tests/db/invoice-history-api.db.test.ts --runInBand` → FAIL.
- [ ] **Step 3: Implement** the lib and both routes. The old `ActivityLogRow` export in the history route goes away; check with `graphify explain "ActivityLogRow"` (or grep) that nothing else imports it.
- [ ] **Step 4: Run to verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** (if asked).

---

### Task 5: History tab and amend reason (web)

**Files:**
- Create: `components/invoices/InvoiceHistoryTimeline.tsx`
- Modify: `components/invoices/InvoiceDetailPanel.tsx:59-66, 105-120, 425-450`
- Modify: `app/(app)/invoices/new/page.tsx` (amend submit ~line 2002 and the amend dialog)

**Interfaces:**
- Consumes: `InvoiceHistoryEntry` (Task 4), `fieldLabel` (Task 2) is not needed client-side because labels arrive in `diff`.
- Produces: `export function InvoiceHistoryTimeline(props: { invoiceId: string; entries: InvoiceHistoryEntry[] }): JSX.Element`

Behaviour:
- Each entry: `action_label` (bold) + description, then "by <user_name or System> • dd MMM yyyy, HH:mm" (keep the existing `date-fns` format), reason in quotes when present.
- Changes list under the entry, collapsed after 5 rows with "Show all N changes": header rows as `Label: before → after` (empty shows "—", money via the existing `formatINR`, dates `dd MMM yyyy`); line rows as "Added item Rice", "Removed item Dal", "Rice: Qty 2 → 3".
- "View this version" on revision entries fetches `/api/invoices/{id}/history/{revision_no}` and shows a read-only dialog: invoice number, date, customer name from snapshot header, line table (name, qty, rate, GST %, amount), total. Use the dialog component the panel already uses for other modals.
- Amend flow: an optional "Reason for change" text input (max 500) above the save button; sent as `reason` in the PATCH body.

- [ ] **Step 1:** Build `InvoiceHistoryTimeline` and swap it into the History tab (the `HistoryEntry` interface in the panel is replaced by `InvoiceHistoryEntry`).
- [ ] **Step 2:** Add the reason input to the amend flow.
- [ ] **Step 3: Type-check and lint** — `npx tsc --noEmit -p .` and `npx eslint components/invoices/InvoiceHistoryTimeline.tsx components/invoices/InvoiceDetailPanel.tsx "app/(app)/invoices/new/page.tsx"` → no new errors.
- [ ] **Step 4:** Per the project's staging-first testing rule, write manual test steps into the session log entry (create → edit draft → finalize → amend with reason → record payment → cancel; History shows six entries with the right changes; "View this version" on revision 1 shows the original lines). Do not run a local browser pass unless the user asks.
- [ ] **Step 5: Commit** (if asked).

---

### Task 6: Docs, graph, log

**Files:**
- Modify: `docs/KHATARIO_USER_GUIDE.md` (Invoices → History: what is recorded, that it cannot be edited or turned off, "System" entries)
- Modify: `docs/roadmap.md` (card "Invoice history (audit trail)" → Now, linking this plan)
- Modify: `docs/project.log.md` (append entry)

- [ ] **Step 1:** Update the three docs.
- [ ] **Step 2:** `graphify update .`
- [ ] **Step 3: Full check** — `npx jest tests/lib/invoices tests/db/invoice-revisions.db.test.ts tests/db/invoice-history-api.db.test.ts tests/db/invoice-amend-fields.db.test.ts --runInBand` → PASS; `npx tsc --noEmit -p .` → clean.
- [ ] **Step 4: Commit** (if asked).

---

## Out of scope (next plans)

- **Flutter tenant app:** show the same History (it can call the same two endpoints).
- **Editing items and amounts on final invoices** (permission, reposting, "Revised" PDF). This history must ship first so those edits are recorded from day one.
- **History for purchases, credit notes, payments as documents of their own:** the same migration pattern applies table by table.
- **Staging/production rollout:** migration 469 runs a backfill over all invoices; time it on a staging copy before production.
