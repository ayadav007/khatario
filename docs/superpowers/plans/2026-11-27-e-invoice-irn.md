# E-Invoice (IRN) for Sales Invoices: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business covered by e-invoicing generates and cancels the IRN for a B2B, SEZ, export or deemed-export sales invoice from Khatario, optionally with its e-way bill in the same step, and the IRN and QR print on the invoice.

**Architecture:** Built on Plan 1's Masters India client and connection. A payload builder turns a final invoice into Masters India's e-invoice request and lists every problem before any call is made. The API call happens outside a database transaction; the result is then stored on the invoice. An invoice with an active IRN is locked: it cannot be amended, edited or cancelled until the IRN is cancelled.

**Tech Stack:** Next.js route handlers, TypeScript, PostgreSQL, Jest, `qrcode` and `qrcode.react` (already dependencies).

**Spec:** `docs/plan/GST_EINVOICE_EWAY_API.md`. API reference: `Einvoice API_EnterpriseDoc.pdf` (owner's Downloads folder, not in the repo).

**Depends on:** `docs/superpowers/plans/2026-11-27-gsp-connection-eway-bills.md` Tasks 1 to 7 merged (client, credentials, `buildEwayBill`, `createEwayBill` with the `gsp` argument, `EwayBillInputError` with a code).

**Not in this plan:** credit and debit notes, the IRN block on every template and thermal print, the phone app, generating automatically on finalise. They are Plan 3.

## Global Constraints

- Everything in Plan 1's Global Constraints applies unchanged (test database only, session-derived identity, no secrets or bodies in logs, GSP call never inside a transaction, staged commits, `MASTERSINDIA_BASE_URL`).
- Only these invoices are ever sent: `status = 'final'`, a tax invoice (not proforma, not bill of supply), `supply_type` in `b2b`, `sez`, `export`, `deemed_export`. A B2C invoice is never sent.
- Document number rule (from the PDF): at most 16 characters, must not start with `0`, `/` or `-`, only letters, digits, `/` and `-`.
- Tolerances (from the PDF): a passed tax or total may differ from the calculated one by about one rupee; round-off must be within ±99.99; at most 1000 items; payload under 2 MB.
- An IRN can be cancelled only within 24 hours of its acknowledgement date and only when the invoice has no active e-way bill.
- Migration number: next free at execution time (478 when written, after Plan 1's 477).
- Plain-language UI copy; no em dashes.

## Review Focus

1. **The portal generated the IRN but the answer never arrived (timeout), and the user clicks again.** Expected: the IRN is fetched by document number and stored; no "Duplicate IRN" dead end. Pinned in Task 4.
2. **An export invoice.** Buyer GSTIN `URP`, state and place of supply `96`, pincode `999999`, IGST only. Expected: built that way without the user typing any of it. Pinned in Task 2.
3. **An invoice with an active IRN is edited through a path other than Amend** (draft edit route, cancel, delete). Expected: refused everywhere with the same message. Pinned in Task 5.
4. **A B2B tax invoice of an e-invoicing GSTIN is sent to the plain e-way bill API.** Expected: never; it goes through the IRN, or the user is told to generate the e-invoice first. Pinned in Task 5.
5. **Rounding.** Line taxes computed per line and an invoice-level round-off. Expected: totals sent are the invoice's stored totals, round-off is the stored difference, and an invoice outside the tolerance is reported as a problem before any call. Pinned in Task 2.

## File Structure

| File | Responsibility |
| --- | --- |
| `database/migrations/478_einvoice_irn.sql` (new) | IRN columns on `invoices`, start date on `businesses` and `branches`, the monthly limit |
| `lib/gst/einvoice-settings.ts` (new) | Whether and from when a registration is covered by e-invoicing |
| `lib/gsp/mastersindia/einvoice-payload.ts` (new) | Invoice → request body, and the list of problems |
| `lib/gsp/mastersindia/einvoice.ts` (new) | The four e-invoice calls |
| `lib/gst/einvoice.ts` (new) | Generate and cancel: limit, call, recovery, storing |
| `lib/gst/einvoice-lock.ts` (new) | The one guard every invoice write path calls |
| `app/api/invoices/[id]/einvoice/route.ts` (new) | `GET` problems and status, `POST` generate, `DELETE` cancel |
| `app/api/gsp/einvoice-settings/route.ts` (new) | Read and set the start dates |
| `components/invoices/EinvoicePanel.tsx` (new) | Status, problems, generate, cancel, QR |
| `components/integrations/EinvoiceCoverageCard.tsx` (new) | Start date per GSTIN on the plugin page |

---

### Task 1: Schema, coverage setting and limit

**Files:**
- Create: `database/migrations/478_einvoice_irn.sql`, `lib/gst/einvoice-settings.ts`, `app/api/gsp/einvoice-settings/route.ts`, `components/integrations/EinvoiceCoverageCard.tsx`
- Modify: `lib/subscription/limit-registry.ts`, `app/(app)/settings/integrations/[id]/page.tsx` (render the card when `id === 'gst-masters-india'`)
- Test: `tests/db/einvoice-settings.db.test.ts`

Migration (test database only):

```sql
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS irn VARCHAR(64),
  ADD COLUMN IF NOT EXISTS irn_ack_no VARCHAR(20),
  ADD COLUMN IF NOT EXISTS irn_ack_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS irn_signed_qr TEXT,
  ADD COLUMN IF NOT EXISTS irn_signed_invoice TEXT,
  ADD COLUMN IF NOT EXISTS irn_status VARCHAR(10) CHECK (irn_status IN ('active', 'cancelled')),
  ADD COLUMN IF NOT EXISTS irn_cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS irn_cancel_reason VARCHAR(120),
  ADD COLUMN IF NOT EXISTS irn_last_error TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_business_irn ON invoices (business_id, irn) WHERE irn IS NOT NULL;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS einvoice_from DATE;
ALTER TABLE branches   ADD COLUMN IF NOT EXISTS einvoice_from DATE;

INSERT INTO platform_limits (limit_key, category, label, description, unit, default_value, sort_order) VALUES
  ('max_einvoices_per_month', 'sales', 'e-Invoices per month', 'Maximum e-invoices (IRN) generated per month', 'per month', 0, 8)
ON CONFLICT (limit_key) DO NOTHING;
-- Per-plan values: copy each plan's max_eway_bills_per_month row, the way migration 360 sets plan limits (read 360 lines 150-175 for the table and columns).
```

**Interfaces:**
- Produces:

```ts
// lib/gst/einvoice-settings.ts
export type EinvoiceRegistration = { key: 'business' | string /* branch id */; gstin: string; label: string; einvoice_from: string | null };
/** The business GSTIN plus every branch holding a different GSTIN. */
export async function listEinvoiceRegistrations(db: Queryable, businessId: string): Promise<EinvoiceRegistration[]>;
export async function setEinvoiceFrom(db: Queryable, businessId: string, key: string, date: string | null): Promise<void>;   // throws on an unknown key or a bad date
/** Start date of the registration this branch issues under (branch with its own GSTIN, else the business); null when not covered. */
export async function einvoiceFromFor(db: Queryable, businessId: string, branchId: string | null): Promise<string | null>;
export function einvoiceApplies(inv: { status: string; document_type: string | null; supply_type: string | null; invoice_date: string }, einvoiceFrom: string | null): boolean;

// limit-registry: LimitCheckType gains 'einvoices' → 'max_einvoices_per_month';
// count: SELECT COUNT(*)::int FROM invoices WHERE business_id = $1 AND irn IS NOT NULL AND irn_ack_date >= DATE_TRUNC('month', CURRENT_DATE)
```

`einvoiceApplies` is true only when `einvoiceFrom` is set, `status === 'final'`, `document_type` is not `proforma_invoice` or `bill_of_supply`, `supply_type` is one of `b2b`, `sez`, `export`, `deemed_export`, and `invoice_date >= einvoiceFrom`.

Route `GET/PUT /api/gsp/einvoice-settings`: `requireTenantPermission(request, …, 'settings', 'read' | 'update')` as `app/api/integrations/[id]/route.ts` does; `PUT` body `{ key, einvoice_from }`; plan gate `denyIfFeatureMissing(businessId, 'e_invoice')`.

Card copy: title `E-invoicing`; one row per registration with a date field labelled `E-invoicing applies from`; help text `E-invoicing applies once your total turnover in any year since 2017-18 crossed ₹5 crore. Set the date it started for this GSTIN. Leave it blank if it does not apply.`

- [ ] **Step 1: Write the failing DB test**

```ts
it('lists the business GSTIN and only branches with a different GSTIN', async () => {
  // business GSTIN A; branch 1 no GSTIN; branch 2 GSTIN B
  expect((await listEinvoiceRegistrations(pool, businessId)).map((r) => r.gstin)).toEqual([A, B]);
});
it('resolves the start date by the registration a branch issues under', async () => {
  await setEinvoiceFrom(pool, businessId, 'business', '2026-04-01');
  await setEinvoiceFrom(pool, businessId, branch2Id, '2026-10-01');
  expect(await einvoiceFromFor(pool, businessId, null)).toBe('2026-04-01');
  expect(await einvoiceFromFor(pool, businessId, branch1Id)).toBe('2026-04-01');
  expect(await einvoiceFromFor(pool, businessId, branch2Id)).toBe('2026-10-01');
});
it('rejects a branch of another business', async () => {
  await expect(setEinvoiceFrom(pool, businessId, otherBusinessBranchId, '2026-04-01')).rejects.toThrow();
});
it('applies only to final B2B-type tax invoices on or after the start date', () => {
  const base = { status: 'final', document_type: 'tax_invoice', supply_type: 'b2b', invoice_date: '2026-11-01' };
  expect(einvoiceApplies(base, '2026-04-01')).toBe(true);
  expect(einvoiceApplies(base, null)).toBe(false);
  expect(einvoiceApplies({ ...base, supply_type: 'b2c_small' }, '2026-04-01')).toBe(false);
  expect(einvoiceApplies({ ...base, document_type: 'bill_of_supply' }, '2026-04-01')).toBe(false);
  expect(einvoiceApplies({ ...base, invoice_date: '2026-03-31' }, '2026-04-01')).toBe(false);
  expect(einvoiceApplies({ ...base, status: 'draft' }, '2026-04-01')).toBe(false);
});
```

- [ ] **Step 2: Run** `npx jest tests/db/einvoice-settings.db.test.ts --runInBand`. Expected: FAIL.
- [ ] **Step 3: Write the migration, apply it to the test database only, implement** the settings module, the limit type, the route and the card.
- [ ] **Step 4: Run** the test and `npx tsc --noEmit` (add `einvoices` to every `Record<LimitCheckType, …>` it reports: owner module `billing`, label `e-Invoices`). Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "feat(einvoice): IRN columns, coverage date per GSTIN and monthly limit"`.

---

### Task 2: Request builder and pre-checks

**Files:**
- Create: `lib/gsp/mastersindia/einvoice-payload.ts`
- Modify: `lib/gst/eway-json.ts` (export the existing `seller` as `sellerParty` and `party` as `customerParty`; no behaviour change)
- Test: `tests/lib/gsp/einvoice-payload.test.ts`

**Interfaces:**
- Consumes: `sellerParty`, `customerParty`, `splitAddress` (`lib/gst/eway-json.ts`); `resolveSupplierRegistration` (`lib/gst/registration.ts`); `EwayTransport` (Plan 1 Task 5).
- Produces:

```ts
export type EinvoiceProblem = { field: string; message: string; fix?: { kind: 'customer' | 'item' | 'business' | 'invoice'; id: string | null } };
export type EinvoiceBuild = { payload: Record<string, unknown> | null; problems: EinvoiceProblem[]; sellerGstin: string | null; docNumber: string; docDate: string /* DD/MM/YYYY */ };
export async function buildEinvoice(
  db: Queryable, businessId: string, invoiceId: string,
  opts?: { ewb?: { distanceKm: number; transport: EwayTransport } | null },
): Promise<EinvoiceBuild>;   // payload is null when problems is non-empty
```

Mapping (Masters India key ← source):

| Block | Fields |
| --- | --- |
| top | `user_gstin` ← seller GSTIN; `data_source: 'erp'` |
| `transaction_details` | `supply_type`: `b2b` → `B2B`; `deemed_export` → `DEXP`; `export` → `EXPWOP` when `export_type = 'wop'` else `EXPWP`; `sez` → `SEZWOP` when `export_type = 'wop'` else `SEZWP`. `charge_type`: `Y` when `is_reverse_charge` else `N`. `igst_on_intra: 'N'`. `ecommerce_gstin` ← `ecommerce_operator_gstin` or `''` |
| `document_details` | `document_type: 'INV'`, `document_number` ← `invoice_number`, `document_date` ← `invoice_date` as `DD/MM/YYYY` |
| `seller_details` | `gstin`, `legal_name` ← business name, `address1`/`address2` ← `splitAddress(registration address, 100)`, `location` ← city, `pincode` (number), `state_code` (two digits), `phone_number`, `email` (omit when empty) |
| `buyer_details` | `gstin` ← `invoices.customer_gstin`; `legal_name` ← `COALESCE(company_name, name)`; `address1`/`address2` ← billing address split at 100; `location` ← city; `pincode`; `state_code` ← first two digits of the GSTIN; `place_of_supply` ← `place_of_supply_state_code`. **Export:** `gstin: 'URP'`, `state_code: '96'`, `place_of_supply: '96'`, `pincode: 999999` |
| `dispatch_details` | only when the dispatch pincode differs from the registration's: `company_name`, `address1`, `address2`, `location`, `pincode`, `state_code` from `sellerParty` |
| `ship_details` | only when ship-to differs (Plan 1 Task 4 rule): `gstin` ← customer GSTIN or `URP`, `legal_name`, `address1`, `address2`, `location`, `pincode`, `state_code` |
| `export_details` | only for `export`: `ship_bill_number`, `ship_bill_date`, `port_code`, `country_code` (omit when unknown), `refund_claim: 'N'` |
| `value_details` | `total_assessable_value` ← sum of line taxable values; `total_cgst_value`, `total_sgst_value`, `total_igst_value`, `total_cess_value` ← sums of the line amounts; `total_discount: 0`; `total_other_charge: 0`; `round_off_amount` ← `grand_total − Σ total_item_value`; `total_invoice_value` ← `grand_total` |
| `item_list[]` | `item_serial_number` ← 1-based position as a string; `product_description` ← `item_name` (cut to 300); `is_service` ← `Y` when HSN starts with `99`; `hsn_code`; `quantity` ← `quantity × unit_factor`; `unit` ← item UQC, else `OTH`; `unit_price`; `total_amount` ← `taxable_value + discount_amount`; `discount` ← `discount_amount`; `assessable_value` ← `taxable_value`; `gst_rate` ← `tax_rate`; `igst_amount`, `cgst_amount`, `sgst_amount`; `cess_amount`; `total_item_value` ← `taxable_value + cgst + sgst + igst + cess` |
| `ewaybill_details` | only when `opts.ewb`: `transporter_id`, `transporter_name`, `transportation_mode` (`'1'` road, `'2'` rail, `'3'` air, `'4'` ship), `transportation_distance`, `transporter_document_number`, `transporter_document_date`, `vehicle_number`, `vehicle_type` (`R` or `O`) |

All money values rounded to 2 decimals. Blocks with nothing to say are omitted, not sent empty.

Problems (each is one entry; messages exact, `<…>` filled in):
- not final → `Finalise the invoice first`
- proforma, bill of supply, or `supply_type` outside the four → `This invoice does not need an e-invoice`
- already `irn_status = 'active'` → `This invoice already has an e-invoice`
- seller GSTIN missing → `Add your GSTIN in Business settings` (fix: business)
- buyer GSTIN missing and not export → `Add the customer's GSTIN` (fix: customer)
- document number fails the rule → `Invoice number <no> cannot be used for an e-invoice. It must be at most 16 characters, use only letters, digits, / and -, and not start with 0, / or -.`
- seller or buyer pincode missing or not 6 digits → `Add the PIN code of <your business address | customer name>`
- buyer state code and place of supply missing → `Choose the place of supply`
- a line without a 4 to 8 digit HSN → `Add the HSN code for <item name>` (fix: item)
- a goods line (HSN not starting 99) with zero quantity → `Enter the quantity for <item name>`
- more than 1000 lines → `An e-invoice can carry at most 1000 items`
- `|round_off_amount| > 99.99` → `The invoice total differs from its lines by more than ₹99.99`
- inter-state rule: when seller state ≠ place of supply (or export or SEZ) any line with CGST or SGST → `This is an inter-state supply, so it must carry IGST`; when the same state, any line with IGST → `This is a supply within the state, so it must carry CGST and SGST`
- `opts.ewb` given and every line is a service → `An e-way bill needs at least one goods line`

- [ ] **Step 1: Write the failing tests** with a `fakeDb` in the style of `tests/lib/gst/eway-json-dispatch.test.ts` (invoice row, invoice lines, customer row, registration row):

```ts
it('builds an intra-state B2B invoice with stored totals and round-off', async () => {
  const b = await buildEinvoice(db({ lines: [{ taxable_value: 1000, tax_rate: 18, cgst_amount: 90, sgst_amount: 90 }], grandTotal: 1180 }), 'biz', 'inv');
  expect(b.problems).toEqual([]);
  const p: any = b.payload;
  expect(p.transaction_details).toMatchObject({ supply_type: 'B2B', charge_type: 'N', igst_on_intra: 'N' });
  expect(p.document_details).toEqual({ document_type: 'INV', document_number: 'INV-001', document_date: '01/10/2026' });
  expect(p.item_list[0]).toMatchObject({ item_serial_number: '1', gst_rate: 18, assessable_value: 1000, cgst_amount: 90, sgst_amount: 90, igst_amount: 0, total_item_value: 1180 });
  expect(p.value_details).toMatchObject({ total_assessable_value: 1000, total_cgst_value: 90, total_sgst_value: 90, total_invoice_value: 1180, round_off_amount: 0 });
});
it('carries the stored round-off', async () => {
  const b = await buildEinvoice(db({ lines: [{ taxable_value: 999.5, tax_rate: 18, igst_amount: 179.91 }], grandTotal: 1179, pos: '33' }), 'biz', 'inv');
  expect((b.payload as any).value_details.round_off_amount).toBe(-0.41);
});
it('builds an export invoice without any typed buyer details', async () => {
  const b = await buildEinvoice(db({ supplyType: 'export', exportType: 'wop', customerGstin: null, pos: '96' }), 'biz', 'inv');
  expect((b.payload as any).transaction_details.supply_type).toBe('EXPWOP');
  expect((b.payload as any).buyer_details).toMatchObject({ gstin: 'URP', state_code: '96', place_of_supply: '96', pincode: 999999 });
});
it('never builds a B2C invoice', async () => {
  const b = await buildEinvoice(db({ supplyType: 'b2c_small' }), 'biz', 'inv');
  expect(b.payload).toBeNull();
  expect(b.problems.map((x) => x.message)).toEqual(['This invoice does not need an e-invoice']);
});
it.each([
  ['0INV/1', /cannot be used for an e-invoice/], ['INV/2026-27/000123', /at most 16 characters/], ['INV#1', /cannot be used/],
])('refuses the document number %s', async (no, re) => {
  expect((await buildEinvoice(db({ invoiceNumber: no }), 'biz', 'inv')).problems[0].message).toMatch(re);
});
it('lists every missing master field at once, with the record to fix', async () => {
  const b = await buildEinvoice(db({ customerGstin: null, customerPincode: null, lines: [{ hsn_sac: '', item_id: 'it1', item_name: 'Steel rod' }] }), 'biz', 'inv');
  expect(b.problems.map((x) => [x.message, x.fix?.kind])).toEqual([
    ["Add the customer's GSTIN", 'customer'], ['Add the PIN code of Chennai Buyer', 'customer'], ['Add the HSN code for Steel rod', 'item'],
  ]);
});
it('reports a total outside the round-off tolerance', async () => { /* grandTotal 1300 vs lines 1180 → the ₹99.99 message */ });
it('reports CGST on an inter-state supply', async () => { /* seller 29, pos 33, cgst_amount 90 */ });
it('adds ewaybill_details only when asked, and refuses when there are no goods', async () => { /* mode road → transportation_mode '1', vehicle_type 'R'; all lines HSN 99xx → the goods message */ });
it('adds ship_details when goods go to another address', async () => { /* reuse the Plan 1 Task 4 shipping fixture */ });
```

- [ ] **Step 2: Run** `npx jest tests/lib/gsp/einvoice-payload.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `buildEinvoice`.** One query for the invoice (with `invoice_date::text`), one for its lines joined to `items` for `uqc` (the same join `eway-json.ts` uses), one for the customer. Collect all problems before returning; never throw for data problems.
- [ ] **Step 4: Run** the test, `npx jest tests/lib/gst` (the export rename must not break the e-way tests) and `npx tsc --noEmit`. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "feat(einvoice): request builder with pre-checks"`.

---

### Task 3: Masters India e-invoice calls

**Files:**
- Create: `lib/gsp/mastersindia/einvoice.ts`
- Modify: `scripts/gsp/sandbox-smoke.ts` (add the e-invoice section), `tests/fixtures/gsp/` (add `einvoice-generate-ok.json`, `einvoice-generate-with-ewb.json`, `einvoice-rejected.json`, `einvoice-duplicate.json`, `einvoice-by-doc.json`, `einvoice-cancel-ok.json`, `ewb-by-irn-ok.json`)
- Test: `tests/lib/gsp/mastersindia-einvoice.test.ts`

**Needs the owner:** the same sandbox login as Plan 1 Task 2, with a sandbox GSTIN enabled for e-invoicing (the PDF uses seller `09AAAPG7885R002`, buyer `05AAAPG7885R002`).

**Interfaces:**
- Produces:

```ts
export type MiIrnResult = {
  irn: string; ackNo: string; ackDate: Date; signedQr: string; signedInvoice: string | null; status: 'ACT' | 'CNL';
  ewb: { number: string; generatedAt: Date; validUntil: Date | null; printUrl: string | null } | null;
  ewbError: string | null;          // from InfoDtls when the IRN succeeded but the e-way bill did not
  pdfUrl: string | null; requestId: string | null;
};
export async function miGenerateIrn(creds: GspCredentials, payload: Record<string, unknown>, deps?: GspDeps): Promise<MiIrnResult>;
export async function miGetIrnByDocument(creds: GspCredentials, a: { gstin: string; docNumber: string; docDate: string /* DD/MM/YYYY */ }, deps?: GspDeps): Promise<MiIrnResult | null>;
export async function miCancelIrn(creds: GspCredentials, a: { gstin: string; irn: string; reason: '1' | '2' | '3' | '4'; remarks: string }, deps?: GspDeps): Promise<{ cancelledAt: Date }>;
export async function miGenerateEwbByIrn(creds: GspCredentials, a: { gstin: string; irn: string; distanceKm: number; transport: EwayTransport }, deps?: GspDeps): Promise<NonNullable<MiIrnResult['ewb']>>;
export const IRN_DUPLICATE_CODES: readonly string[];   // filled from the recorded einvoice-duplicate.json
```

Calls: generate `POST einvoice/`; by document `GET get-einvoice-bydoc` with `user_gstin`, `document_type=INV`, `document_number`, `document_date` (returns `null` when rejected with `nicCode` `2154`); cancel `POST cancel-einvoice/` with `{ user_gstin, irn, cancel_reason, cancel_remarks, ewaybill_cancel: '' }`; e-way bill by IRN `POST gen-ewb-by-irn/` with `user_gstin`, `irn`, `transporter_id`, `transportation_mode` (`'1'` to `'4'`), `transporter_document_number`, `transporter_document_date`, `vehicle_number`, `distance`, `vehicle_type` (`R`/`O`), `transporter_name`, `data_source: 'erp'`.

Reading the generate response: fields are `AckNo`, `AckDt`, `Irn`, `SignedInvoice`, `SignedQRCode`, `EwbNo`, `EwbDt`, `EwbValidTill`, `EinvoicePdf`, `EwaybillPdf`, `Status`. `ackNo` is stored as a string. `ewb` is `null` when `EwbNo` is null. `ewbError`: `info` is a JSON string like `[{"InfCd":"EWBERR","Desc":[{"ErrorCode":"4013","ErrorMessage":"…"}]}]`; when an `EWBERR` entry exists, join its `ErrorMessage` values; unparseable `info` gives `null`.

- [ ] **Step 1: Extend the smoke script** to generate one IRN from the PDF's sample request (#2) with a fresh document number and today's date, generate the same document again (records the duplicate rejection), fetch by document (#6), generate an e-way bill by IRN (#4), generate a second IRN and cancel it (#3). Run it; save the bodies. Fill `IRN_DUPLICATE_CODES` from the recorded code.
- [ ] **Step 2: Write the failing tests:** one per call through a fake `fetch` and its fixture. From the PDF's own bulk sample, pin the partial-success case:

```ts
it('returns the IRN and the e-way bill error when only the e-way bill failed', async () => {
  const body = { results: { message: { AckNo: 142310015934535, AckDt: '2023-09-14 14:18:46', Irn: 'dd7c08b1'.padEnd(64, '0'), SignedInvoice: 's', SignedQRCode: 'q', EwbNo: null, EwbDt: null, EwbValidTill: null, EinvoicePdf: 'https://x/pdf', Status: 'ACT' },
    errorMessage: '', InfoDtls: '[{"InfCd": "EWBERR", "Desc": [{"ErrorCode": "4013", "ErrorMessage": "The distance between the pincodes given is too high or low."}]}]', status: 'Success', code: 200, requestId: 'R' } };
  const r = await miGenerateIrn(creds, {}, { fetch: replyWith(loginOk, body) });
  expect([r.ackNo, r.ewb, r.ewbError]).toEqual(['142310015934535', null, 'The distance between the pincodes given is too high or low.']);
  expect(r.ackDate.toISOString()).toBe('2023-09-14T08:48:46.000Z');
});
it('returns null when no IRN exists for the document', async () => { /* errorMessage '2154: IRN details are not found' */ });
```

- [ ] **Step 3: Run** `npx jest tests/lib/gsp/mastersindia-einvoice.test.ts`. Expected: FAIL. **Implement**, run again. Expected: pass.
- [ ] **Step 4: Check** `grep -rn -i -E "password|token|Authorization" tests/fixtures/gsp/` prints nothing.
- [ ] **Step 5: Commit** `git commit -m "feat(gsp): Masters India e-invoice calls with recorded fixtures"`.

---

### Task 4: Generate the IRN and store it

**Files:**
- Create: `lib/gst/einvoice.ts`, `app/api/invoices/[id]/einvoice/route.ts` (`GET`, `POST`)
- Test: `tests/db/einvoice-generate.db.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3; `loadGspCredentials`; `createEwayBill` with `gsp` (Plan 1 Task 6); `checkLimitInTransaction`; `runWithInvoiceAudit` (`lib/invoices/invoice-audit-context.ts`).
- Produces:

```ts
export class EinvoiceError extends Error { constructor(message: string, readonly status: number, readonly code: string, readonly problems?: EinvoiceProblem[]); }
export type EinvoiceDeps = { loadCredentials?: typeof loadGspCredentials; generate?: typeof miGenerateIrn; getByDocument?: typeof miGetIrnByDocument; cancel?: typeof miCancelIrn; ewbByIrn?: typeof miGenerateEwbByIrn };
export type EinvoiceView = { applies: boolean; status: 'none' | 'active' | 'cancelled'; irn: string | null; ack_no: string | null; ack_date: string | null; signed_qr: string | null; can_cancel: boolean; last_error: string | null; problems: EinvoiceProblem[]; eway_warning: string | null };
export async function getEinvoiceView(businessId: string, invoiceId: string): Promise<EinvoiceView | null>;
export async function generateIrn(businessId: string, userId: string, invoiceId: string,
  opts?: { ewb?: { distanceKm: number; transport: EwayTransport } | null }, deps?: EinvoiceDeps): Promise<EinvoiceView>;
```

Order of work in `generateIrn` and the `EinvoiceError(message, status, code)` each step raises:
1. Invoice not found in this business → `('Invoice not found', 404, 'NOT_FOUND')`.
2. `einvoiceApplies` false → `('E-invoicing is not switched on for this GSTIN, or this invoice does not need one.', 409, 'NOT_APPLICABLE')`.
3. No credentials → `('Connect your Masters India account in Settings, Integrations first.', 409, 'GSP_NOT_CONNECTED')`.
4. `buildEinvoice`; problems → `('Fix these before generating the e-invoice', 422, 'PRECHECK_FAILED', problems)`.
5. Limit `einvoices` in a short transaction → `(check.message, 403, 'LIMIT_EXCEEDED')`.
6. `generate`. On `GspError`:
   - `timeout`, `unreachable`, or `rejected` with a code in `IRN_DUPLICATE_CODES` → `getByDocument` once. Found with status `ACT` → continue with it. Otherwise → `('The e-invoice portal did not answer. Wait a minute and try again; Khatario will pick up the e-invoice if it was created.', 502, 'GSP_NO_ANSWER')` for the first two, and the rejection text for a duplicate that cannot be fetched.
   - other `rejected` → store the text in `irn_last_error`, then `('E-invoice portal: ' + message, 422, 'GSP_REJECTED')`.
   - `auth`, `not_configured` → the same messages and codes as Plan 1 Task 6.
7. Store through `runWithInvoiceAudit({ actorUserId: userId, action: 'einvoice_generated' }, …)`: set `irn`, `irn_ack_no`, `irn_ack_date`, `irn_signed_qr`, `irn_signed_invoice`, `irn_status = 'active'`, `irn_last_error = NULL`. When `result.ewb` is set, `createEwayBill` in the same transaction with `gsp.generatedVia = 'irn'` (the `ParsedEwayBill` built from `buildEwayBill`, as in Plan 1 Task 6 step 7).
8. Return `getEinvoiceView`, with `eway_warning = 'E-invoice generated. The e-way bill was not: ' + result.ewbError` when the caller asked for an e-way bill and none came back.

If `'einvoice_generated'` is not an accepted audit action, add it (and `'einvoice_cancelled'`) wherever `'eway_updated'` is declared, including the coverage test that lists invoice writers.

Route: `GET` returns `{ einvoice: EinvoiceView }` (authorize `invoices` `read`); `POST` body `{ ewb?: { distance_km, transport_mode, vehicle_number, is_odc, transporter_gstin, transporter_name, transport_doc_number, transport_doc_date } }` (authorize `invoices` `update` with the invoice's branch, as `app/api/invoices/[id]/eway/route.ts` does; plan gate `denyIfFeatureMissing(businessId, 'e_invoice')`; when `ewb` is present also the `eway_bill` gate). `EinvoiceError` → its status with `{ error, code, problems }`.

- [ ] **Step 1: Write the failing DB tests** (seed as in `tests/db/invoice-amend-fields.db.test.ts`: business with GSTIN and `einvoice_from`, registered customer, HSN item, final B2B invoice):

```ts
const irn = 'a'.repeat(64);
const ok: MiIrnResult = { irn, ackNo: '142310015934386', ackDate: new Date(), signedQr: 'QR', signedInvoice: 'SI', status: 'ACT', ewb: null, ewbError: null, pdfUrl: null, requestId: 'R' };
const deps = (o: Partial<EinvoiceDeps> = {}): EinvoiceDeps => ({ loadCredentials: async () => ({ username: 'u', password: 'p' }), generate: jest.fn(async () => ok), getByDocument: jest.fn(async () => null), ...o });

it('stores the IRN, acknowledgement and QR on the invoice', async () => {
  const v = await generateIrn(businessId, userId, invoiceId, undefined, deps());
  expect([v.status, v.irn, v.ack_no, v.signed_qr, v.can_cancel]).toEqual(['active', irn, '142310015934386', 'QR', true]);
});
it('does not call the portal when a pre-check fails, and returns the problems', async () => {
  const d = deps();
  await expect(generateIrn(businessId, userId, invoiceWithoutHsnId, undefined, d)).rejects.toMatchObject({ code: 'PRECHECK_FAILED', problems: [expect.objectContaining({ message: expect.stringContaining('HSN') })] });
  expect(d.generate).not.toHaveBeenCalled();
});
it('refuses an invoice dated before the start date and a B2C invoice', async () => { /* both → NOT_APPLICABLE, generate not called */ });
it('after a timeout, stores the IRN it finds by document number', async () => {
  const d = deps({ generate: jest.fn(async () => { throw new GspError('timeout', 'slow'); }), getByDocument: jest.fn(async () => ok2) });
  expect((await generateIrn(businessId, userId, invoice2Id, undefined, d)).irn).toBe(ok2.irn);
});
it('after a duplicate rejection, stores the IRN it finds by document number', async () => { /* generate throws rejected with IRN_DUPLICATE_CODES[0] */ });
it('keeps the rejection text on the invoice and stores no IRN', async () => {
  const d = deps({ generate: jest.fn(async () => { throw new GspError('rejected', '3038: Seller details Details:Pincode-101301 does not exists', '3038'); }) });
  await expect(generateIrn(businessId, userId, invoice3Id, undefined, d)).rejects.toMatchObject({ code: 'GSP_REJECTED' });
  const row = (await pool.query('SELECT irn, irn_last_error FROM invoices WHERE id = $1', [invoice3Id])).rows[0];
  expect([row.irn, row.irn_last_error]).toEqual([null, expect.stringContaining('3038')]);
});
it('records the e-way bill that came with the IRN as generated through the IRN', async () => {
  const d = deps({ generate: jest.fn(async () => ({ ...ok3, ewb: { number: '471008880909', generatedAt: new Date(), validUntil: new Date(Date.now() + 864e5), printUrl: null } })) });
  await generateIrn(businessId, userId, invoice4Id, { ewb: { distanceKm: 296, transport: { mode: 'road', vehicleNumber: 'KA01AB1234' } } }, d);
  expect((await pool.query(`SELECT generated_via FROM eway_bills WHERE source_id = $1`, [invoice4Id])).rows[0].generated_via).toBe('irn');
});
it('warns when the IRN came but the e-way bill did not', async () => { /* ewb null, ewbError set → view.eway_warning contains the error; irn stored */ });
it('stops at the monthly e-invoice limit before calling the portal', async () => { /* plan with max_einvoices_per_month = 1 */ });
```

- [ ] **Step 2: Run** `npx jest tests/db/einvoice-generate.db.test.ts --runInBand`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/gst/einvoice.ts` (`generateIrn`, `getEinvoiceView`) and the route's `GET` and `POST`. `can_cancel` is `status === 'active'` and the acknowledgement is under 24 hours old.
- [ ] **Step 4: Run** the DB test, the invoice history coverage test (`npx jest tests/db/invoice-revisions.db.test.ts --runInBand`) and `npx tsc --noEmit`. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "feat(einvoice): generate the IRN from a final invoice"`.

---

### Task 5: Cancel, lock and e-way bill routing

**Files:**
- Create: `lib/gst/einvoice-lock.ts`
- Modify: `lib/gst/einvoice.ts` (`cancelIrn`), `app/api/invoices/[id]/einvoice/route.ts` (`DELETE`), `app/api/invoices/[id]/amend/route.ts` (after the `GSTR1_LOCKED` check near line 154), `app/api/invoices/[id]/route.ts` (its `PUT` and `DELETE`), `app/api/invoices/[id]/cancel/route.ts`, `lib/gst/eway-generate.ts`
- Test: `tests/db/einvoice-cancel-lock.db.test.ts`

**Interfaces:**
- Produces:

```ts
// lib/gst/einvoice-lock.ts
export const IRN_LOCK_MESSAGE = 'This invoice has an e-invoice (IRN), so it cannot be changed. Cancel the e-invoice within 24 hours, or issue a credit note.';
/** Resolves a 409 response body when the invoice has an active IRN, else null. */
export async function irnLock(db: Queryable, businessId: string, invoiceId: string): Promise<{ error: string; code: 'IRN_LOCKED' } | null>;

// lib/gst/einvoice.ts
export async function cancelIrn(businessId: string, userId: string, invoiceId: string,
  a: { reason: 'duplicate' | 'data_entry' | 'order_cancelled' | 'others'; remarks: string }, deps?: EinvoiceDeps): Promise<EinvoiceView>;
```

`cancelIrn` (errors are `EinvoiceError`): no active IRN → `('This invoice has no active e-invoice', 409, 'NO_IRN')`; acknowledgement older than 24 hours → `('An e-invoice can be cancelled only within 24 hours. Issue a credit note instead.', 409, 'CANCEL_WINDOW_CLOSED')`; an `eway_bills` row for this invoice with stored status `active` → `('Cancel the e-way bill first', 409, 'EWAY_ACTIVE')`; `remarks` empty → `('Enter the reason for cancelling', 400, 'REMARKS_REQUIRED')`; then `cancel` with reason code `duplicate` → `'1'`, `data_entry` → `'2'`, `order_cancelled` → `'3'`, `others` → `'4'`; `GspError` mapped as in Task 4; then store `irn_status = 'cancelled'`, `irn_cancelled_at`, `irn_cancel_reason` under audit action `'einvoice_cancelled'`. The IRN itself stays on the row.

Guards: the amend route, the invoice `PUT`, the invoice `DELETE` and the cancel route each call `irnLock` after authorisation and return `NextResponse.json(lock, { status: 409 })` when it is set. Cancelling the IRN does not cancel the invoice; the user cancels the invoice afterwards through the existing route, which now passes because the IRN is no longer active.

E-way bill routing in `generateEwayBillViaGsp` (before Plan 1's step 3), for `source_type === 'invoice'` when `einvoiceApplies(invoice, await einvoiceFromFor(...))`:
- `irn_status = 'active'` → build the transport from the input, call `miGenerateEwbByIrn`, and record with `gsp.generatedVia = 'irn'`. The limit check still runs. `EwayGenerateDeps` (Plan 1 Task 6) gains `ewbByIrn?: typeof miGenerateEwbByIrn` for the tests to inject.
- otherwise → `EwayBillInputError('Generate the e-invoice for this invoice first. Its e-way bill comes through the e-invoice.', 409, 'IRN_REQUIRED')`.

- [ ] **Step 1: Write the failing DB tests**

```ts
it('cancels at the portal, keeps the IRN on the row and marks it cancelled', async () => {
  const cancel = jest.fn(async () => ({ cancelledAt: new Date() }));
  const v = await cancelIrn(businessId, userId, invoiceId, { reason: 'data_entry', remarks: 'Wrong rate' }, deps({ cancel }));
  expect(cancel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ irn, reason: '2', remarks: 'Wrong rate' }), undefined);
  expect([v.status, v.irn]).toEqual(['cancelled', irn]);
});
it('refuses after 24 hours without calling the portal', async () => { /* set irn_ack_date = now() - interval '25 hours' → CANCEL_WINDOW_CLOSED */ });
it('refuses while the invoice has an active e-way bill', async () => { /* → EWAY_ACTIVE, cancel not called */ });
it.each(['amend', 'put', 'delete', 'cancel'])('the %s route refuses an invoice with an active IRN', async (route) => {
  const res = await callRoute(route, lockedInvoiceId);          // invoke the route handler with a session for this business
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe('IRN_LOCKED');
});
it('the cancel route works again once the IRN is cancelled', async () => { /* status 200, invoice status cancelled */ });
it('sends the e-way bill of an IRN invoice through the IRN', async () => {
  const ewbByIrn = jest.fn(async () => ({ number: '401008880911', generatedAt: new Date(), validUntil: new Date(Date.now() + 864e5), printUrl: null }));
  const generate = jest.fn();
  const v = await generateEwayBillViaGsp(businessId, userId, { source_type: 'invoice', source_id: irnInvoiceId, distance_km: 256, vehicle_number: 'KA01AB1234' }, { ...ewayDeps, generate, ewbByIrn });
  expect(generate).not.toHaveBeenCalled();
  expect(v.generated_via).toBe('irn');
});
it('asks for the e-invoice first when the invoice is covered but has no IRN', async () => { /* → code IRN_REQUIRED, neither call made */ });
it('a B2C invoice of the same business still uses the plain e-way bill call', async () => { /* generate called once */ });
```

- [ ] **Step 2: Run** `npx jest tests/db/einvoice-cancel-lock.db.test.ts --runInBand`. Expected: FAIL.
- [ ] **Step 3: Implement** `irnLock`, `cancelIrn`, the route `DELETE` (body `{ reason, remarks }`), the four guards and the routing branch. Search for other writers of invoice amounts before finishing: `grep -rn "UPDATE invoices" app/api lib --include=*.ts | grep -v -E "eway_bill|irn_|paid_amount|balance_amount|payment_status"`; any route that changes lines, totals, customer, number or date gets the guard too.
- [ ] **Step 4: Run** the DB test, `npx jest tests/db/eway-generate.db.test.ts tests/db/invoice-amend-fields.db.test.ts --runInBand` and `npx tsc --noEmit`. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "feat(einvoice): cancel the IRN, lock the invoice, route e-way bills through the IRN"`.

---

### Task 6: Invoice screen and printed invoice

**Files:**
- Create: `components/invoices/EinvoicePanel.tsx`
- Modify: `app/(app)/invoices/[id]/view/page.tsx`, `components/invoices/EwayBillField.tsx:115-121`, `components/invoices/composer/ComposerDetails.tsx:374`, `lib/gst/compliance/checks.ts:498-504`, `lib/invoice-presenter.ts`, `templates/partials/invoice-meta-extra.html`, `lib/bluetooth/invoice-payload-to-receipt.ts`
- Test: `tests/lib/invoice-presenter-irn.test.ts`, extend `tests/lib/gst/compliance-checks.test.ts`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/invoices/[id]/einvoice`; `GenerateEwayBillDialog`'s form fields and `validateEwayForm` (Plan 1 Task 8).
- Produces: presenter fields `irn`, `irn_ack_no`, `irn_ack_date` (formatted `DD/MM/YYYY`), `irn_qr_data_url` (a PNG data URL of `irn_signed_qr` made with the `qrcode` package the way `lib/barcode-renderer.ts` makes its codes), all `null` unless `irn_status === 'active'`.

Panel behaviour (shown on the invoice view only when `einvoice.applies` or `einvoice.status !== 'none'`):
- **No IRN:** a red badge `E-invoice pending`, the line `This invoice is not valid for your customer's tax credit until its e-invoice is generated.`, the problems as a list each with a `Fix` link (customer → the customer's edit page, item → the item's edit page, business → Business settings, invoice → the invoice editor), `last_error` if any, and a primary button **Generate e-invoice** (disabled while there are problems). A checkbox `Also create the e-way bill` (pre-ticked when goods value is over ₹50,000) reveals the transport fields.
- **Active:** IRN, acknowledgement number and date, the QR (`qrcode.react` from `signed_qr`), `eway_warning` if set, and **Cancel e-invoice** while `can_cancel` (dialog: reason select with the four reasons, remarks required, and the line `After cancelling, this invoice number cannot be used for another e-invoice.`).
- **Cancelled:** a grey badge `E-invoice cancelled` with the date and reason.
- `GSP_NOT_CONNECTED` and `GSP_AUTH` show the **Connect Masters India** button, as in Plan 1 Task 8.
- The existing Amend and Cancel buttons on the view page are disabled with the tooltip `IRN_LOCK_MESSAGE` while the IRN is active.

Copy changes:
- `EwayBillField.tsx` and `ComposerDetails.tsx`: replace the "Khatario does not create the IRN" notes with `E-invoice is on for this plan. Generate it from the invoice once it is final.`
- `checks.ts`: in the e-invoicing alert, replace the sentence beginning `Khatario does not generate IRNs yet` with `Connect Masters India in Settings, Integrations and set the date e-invoicing started for your GSTIN; then generate each e-invoice from the invoice.` and point the alert's action at `/settings/integrations/gst-masters-india`.

Printed invoice: `templates/partials/invoice-meta-extra.html` gains a block, rendered only when `irn` is set, with the QR image (30 mm square) and `IRN`, `Ack No`, `Ack Date` lines. The Bluetooth receipt payload reads `irn`, `ack_no`, `ack_date`, `signed_qr_code` from the new columns (its type already has these fields).

- [ ] **Step 1: Write the failing tests**

```ts
it('exposes the IRN and a QR image only for an active e-invoice', async () => {
  const active = await presentInvoice({ ...base, irn: 'a'.repeat(64), irn_ack_no: '1423', irn_ack_date: '2026-11-27T08:00:00Z', irn_signed_qr: 'eyJ.x.y', irn_status: 'active' });
  expect(active.irn).toHaveLength(64);
  expect(active.irn_ack_date).toBe('27/11/2026');
  expect(active.irn_qr_data_url).toMatch(/^data:image\/png;base64,/);
  const cancelled = await presentInvoice({ ...base, irn: 'a'.repeat(64), irn_signed_qr: 'q', irn_status: 'cancelled' });
  expect([cancelled.irn, cancelled.irn_qr_data_url]).toEqual([null, null]);
});
it('the e-invoicing alert no longer says Khatario cannot generate IRNs', () => {
  const alert = runEinvoicingCheck(turnoverAboveFiveCrore);
  expect(alert.body).not.toMatch(/does not generate IRNs/);
  expect(alert.body).toMatch(/Connect Masters India/);
});
```

(Use the presenter's real exported function and the compliance test's existing helper names; read both files first.)

- [ ] **Step 2: Run** `npx jest tests/lib/invoice-presenter-irn.test.ts tests/lib/gst/compliance-checks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the presenter fields, the partial block, the panel, the view-page wiring, the copy changes and the Bluetooth mapping.
- [ ] **Step 4: Run** the two tests, `npx jest tests/templates` (the template field audit must still pass; add the three new fields to its allowed list if it enumerates fields) and `npx tsc --noEmit`. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "feat(einvoice): e-invoice panel on the invoice and IRN with QR on the print"`.

---

### Task 7: Staging checklist and project records

**Files:**
- Create: `docs/superpowers/plans/2026-11-27-e-invoice-irn-staging-checklist.md`
- Modify: `docs/roadmap.md`, `docs/project.log.md`, `docs/KHATARIO_USER_GUIDE.md` (a short "E-invoice" section)

- [ ] **Step 1: Write the checklist** (sandbox only, after Plan 1's checklist passes and migration 478 is applied with owner approval): set the e-invoicing start date for the sandbox GSTIN; a B2B invoice shows `E-invoice pending`; an invoice with a missing HSN lists the problem with a working Fix link and a disabled button; generate, then IRN, acknowledgement and QR show and print on the PDF; Amend and Cancel are disabled with the lock message; generate with `Also create the e-way bill` and see the bill in `/eway-bills` marked as generated through the IRN; a wrong distance gives the IRN plus the e-way bill warning; generate the e-way bill later from the invoice (goes through the IRN); cancel the e-way bill, cancel the e-invoice, then cancel the invoice; a B2C invoice shows no panel; an invoice dated before the start date shows no panel; an export invoice generates without typing buyer details; the monthly limit stops generation with the upgrade message; scan the printed QR with the government's e-invoice QR verification app.
- [ ] **Step 2: Update** the roadmap card, the project log (format in `docs/brain.md`) and the user guide.
- [ ] **Step 3: Run everything once:** `npx jest tests/lib/gsp tests/lib/gst tests/lib/invoice-presenter-irn.test.ts` and `npx jest tests/db/einvoice-settings.db.test.ts tests/db/einvoice-generate.db.test.ts tests/db/einvoice-cancel-lock.db.test.ts tests/db/eway-generate.db.test.ts --runInBand`. Expected: all pass.
- [ ] **Step 4: Commit** `git commit -m "docs: staging checklist and user guide for e-invoices"`.
