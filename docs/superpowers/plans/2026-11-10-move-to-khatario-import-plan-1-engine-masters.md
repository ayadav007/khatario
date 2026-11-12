# Move to Khatario import, plan 1: engine with Customers, Suppliers and Items

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business can upload any app's Excel or CSV export of customers, suppliers or items, match its columns to Khatario's fields, preview the result, import the good rows and undo the import.

**Architecture:** One engine (`lib/import/`) reads the file, guesses column matches, parses values, holds a draft run in the database, commits it in batches of 200 and records every record it creates so the run can be undone. Each section is a definition file listing its fields and three functions (find existing, save row, undo record). Saving goes through service functions extracted from the existing create routes, so manual entry and import share one code path.

**Tech Stack:** Next.js route handlers, PostgreSQL (`pg`), `exceljs` and `csv-parse` (both already installed), React client components, Jest.

**Spec:** `docs/superpowers/specs/2026-11-10-move-to-khatario-import-design.md` (sections 4.1, 4.2, 5, 6, 10, 11, 12). Plans 2 and 3 cover accounts, opening figures, opening bills and the Move to Khatario page.

## Global Constraints

- `business_id` and the acting user come from the session (`requireStrictSession` in `lib/auth-helpers.ts`) on every route. No id from the file or request body is trusted.
- Existing records are never overwritten. A matching row is reported as "already exists" and skipped.
- Match keys, first hit wins: customers and suppliers by GSTIN, then phone, then name (case and spacing ignored); items by code, then barcode, then name.
- Upload limits: `.xlsx` and `.csv` only, 10 MB, 10,000 data rows.
- Commit batch size: 200 rows.
- A draft run older than 24 hours is deleted when the next import for that business starts.
- A section's import needs that module's `create` permission (`customers`, `suppliers`, `items`). Undo needs the same permission.
- Cell text beginning with `=`, `+`, `-` or `@` is stored as text; the problem-rows download escapes it with `csvSafeText` from `lib/csv-safe.ts`.
- Behaviour of `POST /api/customers`, `POST /api/suppliers` and `POST /api/items/import` must not change. Their existing tests must pass unmodified.
- Messages name the row number and column header as they appear in the user's file.
- No opening balance field for customers or suppliers in this plan. Items keep the opening stock quantity field, because today's item import has it; it behaves exactly as today (plan 2 adds the cut-over date and the fresh-business rule).
- Migrations run only against `kh_phase2_test`. Database tests run only when `PHASE2_TEST_DATABASE_URL` is set, in the same way as `tests/db/accounts-schedule3-line.db.test.ts`.
- Commit only if the owner has approved commits for this plan. Stage files by name; never `git add .`. Work is on `main`.
- User-facing copy uses "Import", "Match columns", "Preview", "Already exists", "Needs attention", "Ready", "Undo import", "Don't import".

## Review Focus

1. **Title lines above the header** (Tally and Zoho exports start with the company name and a report title): the header row is found, not assumed to be row 1. Test in Task 2.
2. **The same party twice in one file** (same GSTIN or phone on two rows): the second row is reported as "already exists (row N)", not created twice. Test in Task 8.
3. **File encodings**: UTF-8 with BOM, UTF-16 LE (Tally's CSV), and names in Hindi survive unchanged. Test in Task 2.
4. **Commit interrupted halfway** (browser closed): calling commit again continues from the saved position and saves no row twice. Test in Task 8.
5. **Total and blank rows** at the bottom of a report ("Total", "Grand Total", empty lines): skipped silently and not counted as problems. Test in Task 2.

---

## File structure

| File | Responsibility |
| --- | --- |
| `lib/tax/state-names.ts` | State name, two-letter code and GST number to `{ state, state_code }` |
| `lib/import/types.ts` | Shared types |
| `lib/import/parse-values.ts` | Amount, date, phone, GSTIN, email, PIN code, state, unit, tax rate, boolean readers |
| `lib/import/read-file.ts` | `.xlsx` / `.csv` buffer to header and string rows |
| `lib/import/presets.ts` | Per-app column names and export instructions (data) |
| `lib/import/match-columns.ts` | Column guessing |
| `lib/import/sections/{customers,suppliers,items}.ts`, `index.ts` | Section definitions |
| `lib/import/run.ts` | Draft, preview, commit, undo, history |
| `lib/customers/create-customer.ts` | Extracted from `POST /api/customers` |
| `lib/suppliers/create-supplier.ts` | Extracted from `POST /api/suppliers` |
| `lib/items/create-imported-item.ts` | Extracted from `POST /api/items/import` |
| `lib/import/record-usage.ts` | Finds which tables reference a record, for undo |
| `app/api/import/[section]/{upload,preview,commit,undo,problem-rows}/route.ts`, `app/api/import/history/route.ts` | Routes |
| `components/import/ImportWizard.tsx` and step components | The four steps |
| `app/(app)/import/[section]/page.tsx` | Hosts the wizard |
| `database/migrations/470_import_runs.sql` | Three tables (use the next free number if 470 is taken) |

---

### Task 1: State names and value readers

**Files:**
- Create: `lib/tax/state-names.ts`, `lib/import/types.ts`, `lib/import/parse-values.ts`
- Test: `tests/lib/import/parse-values.test.ts`

**Interfaces:**
- Produces:
  - `resolveState(text: string): { state: string; state_code: string } | null` in `lib/tax/state-names.ts`. Accepts the full name, a two-letter code (`MH`) or the GST number (`27`), ignoring case, spacing and punctuation. Uses the 36 name-to-number pairs now duplicated in `app/api/customers/route.ts` and `app/api/suppliers/route.ts` (the `getStateCode` map).
  - In `lib/import/parse-values.ts`:
    - `type DateOrder = 'dmy' | 'mdy'`
    - `parseAmount(text: string): { amount: number; side: 'debit' | 'credit' | null } | null`
    - `parseDate(text: string, order: DateOrder): string | null` (returns `YYYY-MM-DD`)
    - `isAmbiguousDate(text: string): boolean`
    - `parsePhone(text: string): string | null` (first valid number in the cell, through `normalizePhoneOrNull` from `lib/utils/phone`)
    - `looksLikeGstin(text: string): boolean`, `looksLikeEmail`, `looksLikePincode`, `looksLikePhone`
    - `parseTaxRate(text: string): number | null`
    - `parseBoolean(text: string): boolean | null`
    - `normaliseKey(text: string): string` (lower case, letters and digits only)
    - `resolveUnit(text: string): string | null` (alias table: `pcs/pc/piece/pieces/nos/no/number → PCS`, `kg/kgs/kilogram → KG`, `g/gm/gram → GM`, `l/ltr/litre/liter → LTR`, `ml → ML`, `m/mtr/meter/metre → MTR`, `box/boxes → BOX`, `dz/doz/dozen → DOZ`, `pkt/pack/packet → PKT`, `bag/bags → BAG`, `set/sets → SET`, `pair/pairs/pr → PRS`)

- [ ] **Step 1: Write the failing tests**

```ts
import { parseAmount, parseDate, isAmbiguousDate, parsePhone, looksLikeGstin, parseTaxRate, resolveUnit, normaliseKey } from '@/lib/import/parse-values';
import { resolveState } from '@/lib/tax/state-names';

test('amounts', () => {
  expect(parseAmount('80,000.00 Dr')).toEqual({ amount: 80000, side: 'debit' });
  expect(parseAmount('80000 Cr')).toEqual({ amount: 80000, side: 'credit' });
  expect(parseAmount('-1,250.50')).toEqual({ amount: 1250.5, side: 'credit' });
  expect(parseAmount('(1,250.50)')).toEqual({ amount: 1250.5, side: 'credit' });
  expect(parseAmount('₹ 1,00,000')).toEqual({ amount: 100000, side: null });
  expect(parseAmount('')).toEqual({ amount: 0, side: null });
  expect(parseAmount('abc')).toBeNull();
});
test('dates', () => {
  expect(parseDate('01-04-2026', 'dmy')).toBe('2026-04-01');
  expect(parseDate('1/4/26', 'dmy')).toBe('2026-04-01');
  expect(parseDate('1/4/26', 'mdy')).toBe('2026-01-04');
  expect(parseDate('1-Apr-2026', 'dmy')).toBe('2026-04-01');
  expect(parseDate('2026-04-01', 'mdy')).toBe('2026-04-01');
  expect(parseDate('31/02/2026', 'dmy')).toBeNull();
  expect(isAmbiguousDate('01-04-2026')).toBe(true);
  expect(isAmbiguousDate('13-04-2026')).toBe(false);
  expect(isAmbiguousDate('1-Apr-2026')).toBe(false);
});
test('phone, gstin, tax, unit, state', () => {
  expect(parsePhone('+91 98765 43210')).toBe(parsePhone('9876543210'));
  expect(parsePhone('9876543210, 9123456780')).toBe(parsePhone('9876543210'));
  expect(parsePhone('n/a')).toBeNull();
  expect(looksLikeGstin('27AAAPA1234A1Z5')).toBe(true);
  expect(looksLikeGstin('27AAAPA1234A1Z')).toBe(false);
  expect(parseTaxRate('18%')).toBe(18);
  expect(parseTaxRate('GST 5')).toBe(5);
  expect(parseTaxRate('exempt')).toBe(0);
  expect(resolveUnit('Nos.')).toBe('PCS');
  expect(resolveUnit('Bndl')).toBeNull();
  expect(normaliseKey('GSTIN/UIN ')).toBe('gstinuin');
  expect(resolveState('maharashtra')).toEqual({ state: 'Maharashtra', state_code: '27' });
  expect(resolveState('MH')).toEqual({ state: 'Maharashtra', state_code: '27' });
  expect(resolveState('27')).toEqual({ state: 'Maharashtra', state_code: '27' });
  expect(resolveState('Atlantis')).toBeNull();
});
```

- [ ] **Step 2: Run** `npx jest tests/lib/import/parse-values.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement** the functions above. `lib/import/types.ts` holds the types listed under Task 3 and Task 7 Interfaces; create it now with `DateOrder` and add to it in later tasks.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(import): value readers and state names` (files above, by name).

---

### Task 2: Reading the uploaded file

**Files:**
- Create: `lib/import/read-file.ts`
- Test: `tests/lib/import/read-file.test.ts`

**Interfaces:**
- Produces:
  - `type ReadFileResult = { headers: string[]; rows: string[][]; headerRowNumber: number; firstDataRowNumber: number }`
  - `class ImportFileError extends Error { code: 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'TOO_MANY_ROWS' | 'NO_HEADER' | 'UNREADABLE' }`
  - `readImportFile(buffer: Buffer, fileName: string): Promise<ReadFileResult>`
- Rules the tests do not fully determine:
  - The header row is the first row with at least two non-empty cells that is followed by at least one row with a non-empty cell. Rows above it are ignored.
  - A data row is dropped when every cell is empty, or when its first non-empty cell, through `normaliseKey`, is `total` or `grandtotal`.
  - `.xlsx`: first worksheet only; a formula cell yields its formula text prefixed with `=`, never a computed value; a date cell yields `YYYY-MM-DD`; a number cell yields its plain decimal string.
  - `.csv`: a UTF-8 BOM is stripped; a UTF-16 LE BOM (`FF FE`) is decoded as UTF-16 LE; otherwise UTF-8. Delimiter is comma, or tab or semicolon when the first line has more of those than commas.
  - `rows[i][j]` is always a trimmed string; missing cells are `''`; every row has `headers.length` cells.
  - Row numbers are 1-based as the user sees them in the file.

- [ ] **Step 1: Write the failing tests** (build inputs in the test: CSV as strings/Buffers, `.xlsx` with `exceljs` in memory)

```ts
test('title lines above the header are skipped', async () => {
  const csv = 'Sharma Traders\nList of Ledgers\n\nName,GSTIN/UIN,Mobile\nA,27AAAPA1234A1Z5,9876543210\n';
  const r = await readImportFile(Buffer.from(csv), 'ledgers.csv');
  expect(r.headers).toEqual(['Name', 'GSTIN/UIN', 'Mobile']);
  expect(r.headerRowNumber).toBe(4);
  expect(r.firstDataRowNumber).toBe(5);
  expect(r.rows).toEqual([['A', '27AAAPA1234A1Z5', '9876543210']]);
});
test('blank and total rows are dropped', async () => {
  const csv = 'Name,Amount\nA,10\n\nGrand Total,10\n';
  expect((await readImportFile(Buffer.from(csv), 'x.csv')).rows).toEqual([['A', '10']]);
});
test('UTF-8 BOM, UTF-16 LE and Hindi text', async () => {
  const text = 'Name,City\nशर्मा ट्रेडर्स,पुणे\n';
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  for (const b of [bom, utf16]) {
    const r = await readImportFile(b, 'x.csv');
    expect(r.headers[0]).toBe('Name');
    expect(r.rows[0]).toEqual(['शर्मा ट्रेडर्स', 'पुणे']);
  }
});
test('xlsx formula cell is text, date cell is ISO', async () => { /* cell { formula: '1+1' } → '=1+1'; new Date(2026,3,1) → '2026-04-01' */ });
test('limits and types', async () => {
  await expect(readImportFile(Buffer.from('a'), 'x.pdf')).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  await expect(readImportFile(Buffer.alloc(10 * 1024 * 1024 + 1), 'x.csv')).rejects.toMatchObject({ code: 'TOO_LARGE' });
  await expect(readImportFile(Buffer.from('only one cell\n'), 'x.csv')).rejects.toMatchObject({ code: 'NO_HEADER' });
  const big = 'Name,City\n' + 'A,B\n'.repeat(10001);
  await expect(readImportFile(Buffer.from(big), 'x.csv')).rejects.toMatchObject({ code: 'TOO_MANY_ROWS' });
});
```

- [ ] **Step 2: Run** `npx jest tests/lib/import/read-file.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `readImportFile` with `exceljs` and `csv-parse/sync` (`relax_column_count: true`, `skip_empty_lines: false`).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(import): read xlsx and csv uploads`.

---

### Task 3: Presets and column guessing

**Files:**
- Create: `lib/import/presets.ts`, `lib/import/match-columns.ts`
- Modify: `lib/import/types.ts`
- Test: `tests/lib/import/match-columns.test.ts`

**Interfaces:**
- Produces in `lib/import/types.ts`:

```ts
export type SectionKey = 'customers' | 'suppliers' | 'items';
export type SourceApp = 'tally' | 'vyapar' | 'zoho_books' | 'other';
export type FieldType = 'text' | 'amount' | 'number' | 'date' | 'phone' | 'gstin' | 'email' | 'pincode' | 'state' | 'unit' | 'tax_rate' | 'boolean';
export interface ImportField { key: string; label: string; type: FieldType; required?: boolean; aliases: string[] }
export type ColumnMatches = Record<number, string | null>; // column index → field key, null = Don't import
```

- Produces in `lib/import/presets.ts`:
  - `PRESET_ALIASES: Record<Exclude<SourceApp, 'other'>, Record<SectionKey, Record<string, string[]>>>` (field key → header names)
  - `EXPORT_INSTRUCTIONS: Record<Exclude<SourceApp, 'other'>, Record<SectionKey, string[]>>` (ordered steps shown on the Upload step)
- Produces in `lib/import/match-columns.ts`:
  - `guessColumns(input: { fields: ImportField[]; headers: string[]; sampleRows: string[][]; sourceApp: SourceApp; section: SectionKey; saved: Record<string, string> }): ColumnMatches` (`saved` is normalised header → field key)
- Guess order, per column: (1) `saved`; (2) the app's preset aliases; (3) the field's own `aliases`; (4) values: over the non-empty sample values (up to 50 rows), at least 80% pass the field type's `looksLike…` check, for types `gstin`, `phone`, `email`, `pincode` only; (5) `null`. Headers compare through `normaliseKey`. A field is given to at most one column: the earliest column wins, later ones get `null`.
- Preset data to start from (to be checked against real export files before release, spec 14.6):

| App | Section | Field → headers |
| --- | --- | --- |
| tally | customers, suppliers | name → `Name`, `Ledger Name`, `Particulars`; gstin → `GSTIN/UIN`, `GSTIN`; phone → `Mobile`, `Mobile No.`, `Phone`; email → `E-Mail`, `Email`; address → `Address`; state → `State`, `State Name`; pincode → `Pincode`, `PIN Code`; pan → `PAN/IT No.` |
| tally | items | name → `Name`, `Name of Item`, `Particulars`; unit → `Units`, `UOM`; hsn_sac → `HSN/SAC`, `HSN Code`; tax_rate → `GST Rate`, `Rate of Tax`, `IGST Rate`; category_name → `Under`, `Stock Group`; opening_stock → `Opening Qty`, `Quantity`; purchase_price → `Rate`, `Cost Price`; selling_price → `Selling Price`, `Standard Price`; code → `Alias`, `Part No.` |
| vyapar | customers, suppliers | name → `Name`, `Party Name`; phone → `Phone No.`, `Contact No.`; email → `Email`, `Email ID`; address → `Address`, `Billing Address`; gstin → `GSTIN`, `GSTIN No.`; state → `State` |
| vyapar | items | name → `Item name*`, `Item name`; code → `Item code`; hsn_sac → `HSN`; selling_price → `Sale price`; purchase_price → `Purchase price`; opening_stock → `Opening stock quantity`; min_stock → `Minimum stock quantity`; tax_rate → `Tax Rate`; unit → `Base Unit (x)`, `Base Unit`; category_name → `Category` |
| zoho_books | customers, suppliers | name → `Display Name`, `Contact Name`; company_name → `Company Name`; gstin → `GST Identification Number (GSTIN)`; phone → `MobilePhone`, `Phone`; email → `EmailID`; address → `Billing Address`; city → `Billing City`; state → `Billing State`, `Place of Supply`; pincode → `Billing Code`; pan → `PAN Number` |
| zoho_books | items | name → `Item Name`; code → `SKU`; hsn_sac → `HSN/SAC`; selling_price → `Rate`, `Selling Price`; purchase_price → `Purchase Rate`, `Purchase Price`; unit → `Usage unit`, `Unit`; tax_rate → `Intra State Tax Rate`; item_type → `Product Type`; description → `Description` |

- `EXPORT_INSTRUCTIONS`: two to four short steps per app and section, ending "Save as Excel or CSV, then upload the file here." Write them from each app's own help pages; do not invent menu names you cannot confirm, and say "export the customer list to Excel from your app" where unsure.

- [ ] **Step 1: Write the failing tests**

```ts
const fields: ImportField[] = [
  { key: 'name', label: 'Customer name', type: 'text', required: true, aliases: ['name', 'customer', 'customer name', 'party name', 'party'] },
  { key: 'gstin', label: 'GSTIN', type: 'gstin', aliases: ['gstin', 'gst no', 'gst number'] },
  { key: 'phone', label: 'Phone', type: 'phone', aliases: ['phone', 'mobile', 'contact'] },
];
const base = { fields, sourceApp: 'other' as const, section: 'customers' as const, saved: {} };

test('alias match ignores case and punctuation', () => {
  expect(guessColumns({ ...base, headers: ['PARTY NAME', 'Gst No.'], sampleRows: [] })).toEqual({ 0: 'name', 1: 'gstin' });
});
test('preset beats general alias; saved beats preset', () => {
  expect(guessColumns({ ...base, sourceApp: 'tally', headers: ['Particulars', 'GSTIN/UIN'], sampleRows: [] })).toEqual({ 0: 'name', 1: 'gstin' });
  expect(guessColumns({ ...base, sourceApp: 'tally', headers: ['Particulars'], sampleRows: [], saved: { particulars: 'phone' } })).toEqual({ 0: 'phone' });
});
test('values decide when the header is unknown', () => {
  const rows = [['27AAAPA1234A1Z5', '9876543210'], ['29AAAPA1234A1Z5', '9123456780']];
  expect(guessColumns({ ...base, headers: ['Col A', 'Col B'], sampleRows: rows })).toEqual({ 0: 'gstin', 1: 'phone' });
});
test('unknown column is not imported; a field goes to one column only', () => {
  expect(guessColumns({ ...base, headers: ['Salesman', 'Name', 'Customer'], sampleRows: [] })).toEqual({ 0: null, 1: 'name', 2: null });
});
```

- [ ] **Step 2: Run** `npx jest tests/lib/import/match-columns.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `presets.ts` (data from the table) and `guessColumns`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(import): presets and column guessing`.

---

### Task 4: Customer create service

**Files:**
- Create: `lib/customers/create-customer.ts`
- Modify: `app/api/customers/route.ts` (POST, lines 175-442)
- Test: `tests/db/customer-services.db.test.ts`

**Interfaces:**
- Produces:

```ts
export type ServiceCtx = { businessId: string; userId: string };            // lib/import/types.ts
export type CreateResult<T> =
  | { ok: true; record: T }
  | { ok: false; status: number; code: string; error: string; existing?: T };

export async function createCustomer(ctx: ServiceCtx, input: CreateCustomerInput): Promise<CreateResult<Customer>>;
```

- `CreateCustomerInput` has exactly the body fields the POST handler reads today (`name` … `receivable_account_id`).
- `createCustomer` contains everything in the handler from the phone check (line 233) to the opening-balance ledger post (line 435): phone and email validation, the two duplicate checks (returned as `ok: false`, `status: 200`, `code: 'DUPLICATE_PHONE' | 'DUPLICATE_EMAIL'`, `existing` set), GSTIN and state resolution, receivable account, `enforceAccess` inside the transaction, the insert, the opening-balance post. Replace the inline `getStateCode` with `resolveState` from Task 1.
- The handler keeps: session, body read, `name` check, access boundary, `authorize`, and turning the result into the same JSON and status codes as today (a duplicate still answers `{ customer, deduplicated: true, code, error }` with 200).

- [ ] **Step 1: Run the existing customer tests and note the result** (`npx jest tests -t customer`), so a later difference is attributable.
- [ ] **Step 2: Write the failing DB test** (seed a business, branch, user and plan the way `tests/db/accounts-schedule3-line.db.test.ts` does; purge in `afterAll`)

```ts
test('createCustomer inserts and returns the row', async () => {
  const r = await createCustomer(ctx, { name: 'Sharma Traders', phone: '9876543210', gstin: '27AAAPA1234A1Z5' });
  expect(r.ok).toBe(true);
  if (r.ok) { expect(r.record.state_code).toBe('27'); expect(r.record.business_id).toBe(B); }
});
test('duplicate phone returns the existing customer, creates nothing', async () => {
  const r = await createCustomer(ctx, { name: 'Other', phone: '9876543210' });
  expect(r).toMatchObject({ ok: false, status: 200, code: 'DUPLICATE_PHONE' });
  expect(await count('customers')).toBe(1);
});
test('invalid GSTIN is refused', async () => {
  expect(await createCustomer(ctx, { name: 'X', gstin: '27BAD' })).toMatchObject({ ok: false, status: 400 });
});
```

- [ ] **Step 3: Run** `npx jest tests/db/customer-services.db.test.ts` with `PHASE2_TEST_DATABASE_URL` set. Expected: FAIL, module not found.
- [ ] **Step 4: Extract** the service and thin the handler.
- [ ] **Step 5: Run** the new test and the Step 1 command. Expected: new test PASS; Step 1 result unchanged.
- [ ] **Step 6: Commit** `refactor(customers): create customer as a service`.

---

### Task 5: Supplier create service

**Files:**
- Create: `lib/suppliers/create-supplier.ts`
- Modify: `app/api/suppliers/route.ts` (POST, lines 125-364)
- Test: `tests/db/supplier-services.db.test.ts`

**Interfaces:**
- Consumes: `ServiceCtx`, `CreateResult` (Task 4), `resolveState` (Task 1).
- Produces:

```ts
export async function createSupplier(ctx: ServiceCtx, input: CreateSupplierInput, audit?: { ip: string | null; userAgent: string | null }): Promise<CreateResult<Supplier>>;
```

- `CreateSupplierInput` has the body fields the handler reads today, including `linked_business_id` and `allow_low_stock_access`.
- `createSupplier` contains the PAN check, GSTIN and state resolution, PAN/GSTIN mismatch, `enforceAccess`, the self-link refusal, the GSTIN duplicate check (returned as `ok: false`, `status: 200`, `code: 'DUPLICATE_GSTIN'`, `existing` set), the insert, the opening-balance post, `openConnectionRequest`, and `logActivity` only when `audit` is passed. A `23505` error becomes `ok: false`, `status: 409`, `code: 'DUPLICATE_SUPPLIER'`.
- The handler keeps session, `authorize`, and the same JSON and status codes as today (a GSTIN duplicate still answers `{ supplier, deduplicated: true, message }` with 200).

- [ ] **Step 1: Write the failing DB test**: creates a supplier (state code derived from GSTIN prefix), GSTIN duplicate returns `existing` and creates nothing, PAN not matching GSTIN gives `code: 'PAN_GSTIN_MISMATCH'`, no activity-log row is written when `audit` is omitted and one is written when it is passed.
- [ ] **Step 2: Run** `npx jest tests/db/supplier-services.db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Extract** and thin the handler.
- [ ] **Step 4: Run** the new test and `npx jest tests -t supplier`. Expected: PASS, no existing test changed.
- [ ] **Step 5: Commit** `refactor(suppliers): create supplier as a service`.

---

### Task 6: Item create service

**Files:**
- Create: `lib/items/create-imported-item.ts`
- Modify: `app/api/items/import/route.ts` (the loop, lines 98-170)
- Test: `tests/db/item-services.db.test.ts`

**Interfaces:**
- Consumes: `ServiceCtx`, `CreateResult`.
- Produces:

```ts
export interface ImportItemInput { name: string; code?: string; barcode?: string; unit?: string; item_type?: 'goods' | 'service';
  category_name?: string; selling_price?: number; purchase_price?: number; mrp?: number; tax_rate?: number; hsn_sac?: string;
  opening_stock?: number; min_stock?: number; description?: string; image_url?: string; is_active?: boolean }
export async function createImportedItem(ctx: ServiceCtx, input: ImportItemInput): Promise<CreateResult<{ id: string }>>;
```

- `createImportedItem` is the body of the route's per-row `try` block, unchanged in behaviour: category lookup by name, defaults (`PCS`, `goods`, tax 18, opening stock 0 for services), insert, and for opening stock above zero the stock movement, `seedOpeningStockLayers` and `syncItemOpeningStockLedger`. A missing name returns `ok: false`, `status: 400`, `code: 'MISSING_NAME'`, `error: 'Missing name'`.
- The route keeps tenant, auth, `authorize`, `enforceAccess`, the plan-limit check, the loop and its `{ success, failed, errors }` answer, and `noteShopChanged`.

- [ ] **Step 1: Write the failing DB test**: goods item with `opening_stock: 5` gets `current_stock = 5` and one `stock_movements` row; service item with `opening_stock: 5` gets `0` and no movement; missing name refused; `category_name` matching an existing category sets `category_id`.
- [ ] **Step 2: Run** `npx jest tests/db/item-services.db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Extract** and thin the handler.
- [ ] **Step 4: Run** the new test and `npx jest tests -t item`. Expected: PASS, no existing test changed.
- [ ] **Step 5: Commit** `refactor(items): imported item create as a service`.

---

### Task 7: Section definitions

**Files:**
- Create: `lib/import/sections/customers.ts`, `suppliers.ts`, `items.ts`, `index.ts`, `lib/import/record-usage.ts`
- Modify: `lib/import/types.ts`
- Test: `tests/lib/import/sections.test.ts`, `tests/db/import-sections.db.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 5, 6 (`createCustomer`, `createSupplier`, `createImportedItem`).
- Produces in `lib/import/types.ts`:

```ts
export type RowValues = Record<string, string | number | boolean | null>;
export interface RowIssue { field: string | null; message: string; level: 'error' | 'warning' }
export interface BuiltRow { values: RowValues; issues: RowIssue[]; unmatched: { field: string; value: string }[] }
export interface ExistingMatch { id: string; label: string; matchedOn: string }
export interface SectionDefinition {
  key: SectionKey; label: string; module: 'customers' | 'suppliers' | 'items';
  limitType: 'customers' | 'suppliers' | 'items';
  fields: ImportField[];
  duplicateKeys(values: RowValues): string[];                      // e.g. ['gstin:27AAAPA1234A1Z5', 'phone:919876543210', 'name:sharmatraders']
  findExisting(ctx: ServiceCtx, values: RowValues): Promise<ExistingMatch | null>;
  saveRow(ctx: ServiceCtx, values: RowValues): Promise<{ ok: true; table: string; id: string } | { ok: false; error: string }>;
  undoRecord(ctx: ServiceCtx, id: string): Promise<{ ok: true } | { ok: false; reason: string }>;
}
```

- Produces in `lib/import/sections/index.ts`:
  - `SECTIONS: Record<SectionKey, SectionDefinition>`
  - `buildRow(def: SectionDefinition, cells: string[], headers: string[], matches: ColumnMatches, opts: { dateOrder: DateOrder; valueMatches: Record<string, Record<string, string>> }): BuiltRow`
- `buildRow` rules:
  - Only matched columns are read. Empty cell → `null`.
  - A value that fails its type: `gstin`, `amount`, `number`, `date`, `tax_rate` give an `error` issue (`"GSTIN" is not a valid GSTIN: 27BAD`, naming the user's header); `phone`, `email`, `pincode` give a `warning` and the value becomes `null` (`Imported without phone: "n/a" is not a valid number`).
  - `state`, `unit` and `tax_rate` values go through `opts.valueMatches[field][normalised value]` first, then `resolveState` / `resolveUnit` / `parseTaxRate`; if still unresolved they are added to `unmatched` and the row carries an `error` issue until the user chooses. (So `tax_rate` is removed from the "fails its type" list above.) The choices offered are the state list, the unit list from `resolveUnit`'s targets, and tax rates 0, 0.25, 3, 5, 12, 18, 28.
  - A required field with no value gives an `error` issue (`"Name" is empty`).
  - A row with any `error` issue is "needs attention"; otherwise it is ready (warnings do not block).
- Fields (key, label, type; `name` required in all three; aliases are the general names, presets add app names):
  - customers: `name` Customer name, `company_name` Company name, `phone` Phone, `email` Email, `gstin` GSTIN, `address` Address, `city` City, `state` State, `pincode` PIN code, `shipping_address` Shipping address, `credit_limit` Credit limit (amount), `credit_days` Credit days (number).
  - suppliers: `name` Supplier name, `phone`, `email`, `gstin`, `pan` PAN (text), `address`, `city`, `state`, `pincode`.
  - items: `name` Item name, `code` Item code, `barcode` Barcode, `unit` Unit, `item_type` Type (text; `service` when the value's key contains `service`, else goods), `category_name` Category, `selling_price` Selling price (amount), `purchase_price` Purchase price (amount), `mrp` MRP (amount), `tax_rate` Tax rate, `hsn_sac` HSN/SAC, `opening_stock` Opening stock (number), `min_stock` Minimum stock (number), `description` Description.
- `findExisting` queries only rows of `ctx.businessId` that are not deleted: customers and suppliers by `UPPER(TRIM(gstin))`, then normalised phone, then name compared through lower case with all whitespace removed; items by `code`, then `barcode`, then name the same way. `matchedOn` is `'GSTIN' | 'phone' | 'name' | 'item code' | 'barcode'`.
- `saveRow` calls the Task 4-6 services. A service result of `ok: false` with `existing` set is returned as `{ ok: false, error: 'Already exists: <name>' }`.
- Undo. The app's own delete handlers for customers, suppliers and items are soft deletes with no "is it used" check, so undo has its own rule:
  - `findReferences(table: 'customers' | 'suppliers' | 'items', id: string): Promise<string[]>` in `lib/import/record-usage.ts` returns the names of tables holding at least one row that points to the record. The list of referencing tables and columns is read once per process from the database's foreign keys (`pg_constraint` where `confrelid` is the table), so tables added later are covered without editing a list.
  - `undoRecord`: when `findReferences` returns any table, answer `{ ok: false, reason: 'Used in <table name with underscores as spaces>' }`. Otherwise soft-delete the row (`deleted_at = CURRENT_TIMESTAMP`, scoped by `business_id`), the same statement the DELETE handlers use, and answer `{ ok: true }`.
  - An item imported with opening stock above zero is always referenced (by its stock movement), so it is kept with the reason `Has opening stock. Delete it from the Items list if it is not needed.` Reversing opening stock on undo belongs to plan 2.
- Preset or alias entries for a field a section does not have (for example `pan` on customers) are ignored.

- [ ] **Step 1: Write the failing unit tests** for `buildRow`: a clean customer row is ready; a bad GSTIN is an error naming the header `GSTIN/UIN`; a bad phone is a warning and `values.phone` is `null`; state `MH` resolves to Maharashtra; unit `Bndl` lands in `unmatched` and resolves once `valueMatches.unit.bndl = 'BOX'`; an empty name is an error; `duplicateKeys` for `{ gstin: '27aaapa1234a1z5', phone: '+91 98765 43210', name: 'Sharma  Traders' }` contains `gstin:27AAAPA1234A1Z5` and `name:sharmatraders`.
- [ ] **Step 2: Write the failing DB tests**: `findExisting` matches a customer by GSTIN, then by phone when GSTIN differs, then by name with different case and spacing, and returns `null` for another business's customer with the same GSTIN; `saveRow` then `undoRecord` leaves the row with `deleted_at` set and `findExisting` no longer matches it; `undoRecord` on a customer with an invoice row answers `{ ok: false, reason: 'Used in invoices' }` and leaves `deleted_at` null; an item saved with `opening_stock: 5` is kept with the opening-stock reason; the same checks for suppliers and items (items by code, barcode, name).
- [ ] **Step 3: Run** `npx jest tests/lib/import/sections.test.ts tests/db/import-sections.db.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the three definitions and `buildRow`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(import): customers, suppliers and items sections`.

---

### Task 8: Import runs (draft, preview, commit, undo)

**Files:**
- Create: `database/migrations/470_import_runs.sql`, `lib/import/run.ts`
- Test: `tests/db/import-run.db.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 7.
- Migration (apply to `kh_phase2_test` only):
  - `import_runs`: `id uuid pk`, `business_id uuid not null references businesses`, `section text not null`, `source_app text not null`, `file_name text not null`, `status text not null check (status in ('draft','committing','done','undone','failed'))`, `headers jsonb not null`, `header_row_number int not null`, `first_data_row_number int not null`, `draft_rows jsonb`, `column_matches jsonb`, `value_matches jsonb not null default '{}'`, `date_order text not null default 'dmy'`, `cursor int not null default 0`, `counts jsonb not null default '{}'`, `problem_rows jsonb not null default '[]'`, `created_by uuid not null`, `created_at`, `updated_at`. Index on `(business_id, section, created_at desc)`.
  - `import_run_records`: `run_id uuid not null references import_runs on delete cascade`, `business_id uuid not null`, `record_table text not null`, `record_id uuid not null`, `row_number int not null`, `undone_at timestamptz`, primary key `(run_id, record_table, record_id)`.
  - `import_column_matches`: `business_id uuid not null`, `section text not null`, `header_key text not null`, `field_key text`, primary key `(business_id, section, header_key)`.
- Produces in `lib/import/run.ts`:

```ts
export async function createDraftRun(ctx: ServiceCtx, p: { section: SectionKey; sourceApp: SourceApp; fileName: string; buffer: Buffer }):
  Promise<{ runId: string; headers: string[]; samples: string[][]; guesses: ColumnMatches; fields: ImportField[]; rowCount: number; needsDateOrder: boolean }>;

export interface PreviewResult { ready: number; needsAttention: number; alreadyExists: number; warnings: number;
  unmatched: { field: string; label: string; values: string[] }[];
  problems: { rowNumber: number; status: 'needs_attention' | 'already_exists'; reasons: string[] }[];   // first 50
  missingRequired: string[];  // labels of required fields with no column
  limit: { allowed: boolean; message?: string } }
export async function previewRun(ctx: ServiceCtx, runId: string, p: { columnMatches: ColumnMatches; valueMatches: Record<string, Record<string, string>>; dateOrder: DateOrder }): Promise<PreviewResult>;

export async function commitNextBatch(ctx: ServiceCtx, runId: string): Promise<{ done: boolean; processed: number; total: number; saved: number; skipped: number; failed: number }>;
export async function undoRun(ctx: ServiceCtx, runId: string): Promise<{ removed: number; kept: { label: string; reason: string }[] }>;
export interface RunSummary { id: string; section: SectionKey; sourceApp: SourceApp; fileName: string; status: 'committing' | 'done' | 'undone' | 'failed';
  saved: number; skipped: number; failed: number; processed: number; total: number; createdAt: string; createdByName: string | null }
export async function listRuns(ctx: ServiceCtx, section?: SectionKey): Promise<RunSummary[]>;   // every status except draft, newest first, 50 max
export async function problemRowsCsv(ctx: ServiceCtx, runId: string): Promise<string>;
```

- Rules:
  - Every function loads the run with `WHERE id = $1 AND business_id = $2`; a run of another business is "not found".
  - `createDraftRun` first deletes this business's `draft` runs older than 24 hours, reads the file (Task 2), stores `draft_rows`, loads saved matches from `import_column_matches`, and guesses (Task 3). `samples` is the first 3 rows. `needsDateOrder` is true when a column guessed as a date field has an ambiguous value and no unambiguous one.
  - `previewRun` saves the matches on the run, builds every row (Task 7), and classifies in this order: error issues → needs attention; `findExisting` hit → already exists (`Already exists: <label>, matched on <matchedOn>`); a `duplicateKeys` entry already seen on an earlier row of this file → already exists (`Same as row <n> in this file`); else ready. `limit` comes from `checkLimit(businessId, def.limitType)` against the ready count, as `app/api/items/import/route.ts` does.
  - `commitNextBatch`: refused unless status is `draft` (first call, sets `committing`) or `committing`; refused when `missingRequired`, unresolved `unmatched` values or `limit.allowed === false`. It takes `pg_try_advisory_xact_lock(hashtext(business_id || ':' || section))` and answers 409-style error `IMPORT_BUSY` if not acquired. It processes rows `cursor … cursor+199`, re-classifying each row as in preview (so a row saved earlier in this run is found by `findExisting` and skipped), calls `saveRow` for ready rows, inserts `import_run_records`, appends non-saved rows to `problem_rows`, and advances `cursor` in the same transaction as the bookkeeping. When `cursor` reaches the row count: status `done`, `draft_rows` set to null, `counts` stored, column matches upserted into `import_column_matches`, one activity-log entry written (`Imported <n> <section> from <file_name>`).
  - A `saveRow` failure marks that row failed with its message and continues. An exception outside `saveRow` marks the run `failed`, keeping `cursor`; `commitNextBatch` on a `failed` run resumes.
  - `undoRun`: allowed for `done` and `failed` runs. For each record not yet undone, newest first, call `undoRecord`; on success set `undone_at`; on refusal add to `kept`. Status becomes `undone` when nothing was kept.
  - `problemRowsCsv`: the user's headers plus `Row` and `Reason` columns; every cell through `csvSafeText`.

- [ ] **Step 1: Apply the migration to the test database** with the project's migration runner against `kh_phase2_test` only. Expected: three tables exist.
- [ ] **Step 2: Write the failing DB tests** (customers section; files built as CSV buffers)

```ts
test('draft → preview counts', async () => {
  // existing customer with GSTIN 27AAAPA1234A1Z5 seeded
  // file rows: A (new), B (bad GSTIN), C (GSTIN of existing), D (new, same phone as A)
  const d = await createDraftRun(ctx, { section: 'customers', sourceApp: 'other', fileName: 'c.csv', buffer });
  expect(d.guesses).toEqual({ 0: 'name', 1: 'gstin', 2: 'phone' });
  const p = await previewRun(ctx, d.runId, { columnMatches: d.guesses, valueMatches: {}, dateOrder: 'dmy' });
  expect(p).toMatchObject({ ready: 1, needsAttention: 1, alreadyExists: 2 });
  expect(p.problems.find((x) => x.rowNumber === 5)!.reasons[0]).toMatch(/Same as row 2 in this file/);
});
test('commit saves ready rows only and records them', async () => { /* saved: 1; import_run_records has 1 row; status done; draft_rows null */ });
test('commit resumes after an interruption without saving a row twice', async () => {
  // 450 new rows; call commitNextBatch once (processed 200), then simulate a crash by not calling again;
  // call until done → customers count is exactly 450, import_run_records 450
});
test('undo removes unused records and keeps used ones with a reason', async () => { /* add an invoice for one imported customer → kept.length 1, removed n-1, status stays done */ });
test('another business cannot read, commit or undo the run', async () => { /* each rejects with not found */ });
test('missing required column blocks commit', async () => { /* matches without name → previewRun.missingRequired = ['Customer name']; commitNextBatch rejects */ });
test('saved column matches are reused on the next upload', async () => { /* header 'Client' mapped to name in run 1 → guessed as name in run 2 */ });
test('problem rows csv escapes formulas', async () => { /* a cell '=HYPERLINK(...)' comes back prefixed per csvSafeText */ });
```

- [ ] **Step 3: Run** `npx jest tests/db/import-run.db.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `run.ts`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(import): import runs with preview, batched commit and undo` (migration file and `run.ts` and the test, by name).

---

### Task 9: Routes

**Files:**
- Create: `app/api/import/[section]/upload/route.ts`, `preview/route.ts`, `commit/route.ts`, `undo/route.ts`, `problem-rows/route.ts`, `app/api/import/history/route.ts`, `lib/import/route-guard.ts`
- Test: `tests/db/import-routes.db.test.ts`

**Interfaces:**
- Consumes: Task 8 functions.
- Produces:
  - `guardImportRequest(request: NextRequest, sectionParam: string, action: 'create' | 'read'): Promise<{ ok: true; ctx: ServiceCtx; def: SectionDefinition } | { ok: false; response: NextResponse }>` in `lib/import/route-guard.ts`. It calls `requireStrictSession`, rejects an unknown section with 404, and calls `authorize(userId, def.module, action, { businessId })`.
  - `POST /api/import/[section]/upload`: multipart form with `file` and `source_app`. Answers `createDraftRun`'s result. `ImportFileError` → 400 with `{ error, code }`. Messages: `UNSUPPORTED_TYPE` "Upload an Excel (.xlsx) or CSV file."; `TOO_LARGE` "This file is larger than 10 MB."; `TOO_MANY_ROWS` "This file has more than 10,000 rows. Split it into smaller files."; `NO_HEADER` "No column headings were found in this file."; `UNREADABLE` "This file could not be read. Save it again as Excel or CSV and retry."
  - `POST …/preview`: body `{ run_id, column_matches, value_matches, date_order }` → `PreviewResult`.
  - `POST …/commit`: body `{ run_id }` → one batch result. `IMPORT_BUSY` → 409 "Another import for this list is running. Wait for it to finish."
  - `POST …/undo`: body `{ run_id }` → `undoRun` result.
  - `GET …/problem-rows?run_id=`: `text/csv` attachment `import-problems.csv`.
  - `GET /api/import/history?section=`: `{ runs: RunSummary[] }`; needs `read` on the section's module (all three modules checked when no section is given, runs of unreadable modules left out).
  - All routes `export const dynamic = 'force-dynamic'`. No route reads `business_id` or `user_id` from the body or query.

- [ ] **Step 1: Write the failing route tests** (call handlers directly with the header-bag pattern of `tests/db/accounts-schedule3-line.db.test.ts`): upload → preview → commit loop → history → undo for a small customers file, asserting status 200 at each step and the final customer count; a request with a `business_id` of another business in the body still acts on the session's business; a user without `customers` `create` gets 403 on upload; unknown section → 404; a `.pdf` upload → 400 with code `UNSUPPORTED_TYPE`.
- [ ] **Step 2: Run** `npx jest tests/db/import-routes.db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the guard and routes.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(import): import API routes`.

---

### Task 10: Wizard and Import buttons

**Files:**
- Create: `components/import/ImportWizard.tsx`, `components/import/UploadStep.tsx`, `MatchColumnsStep.tsx`, `PreviewStep.tsx`, `ImportingStep.tsx`, `ImportHistory.tsx`, `app/(app)/import/[section]/page.tsx`
- Modify: `app/(app)/customers/page.tsx`, the suppliers list page, `app/(app)/items/page.tsx` (remove the hidden CSV input at lines 845-903, the `importing` state and its trigger; point the existing Import control at `/import/items`), `e2e/routes.json`, `lib/breadcrumb-utils.ts`, `lib/mobile-route-title.ts`
- Test: `tests/lib/import/wizard-state.test.ts`, and the existing `tests/lib/nav-active.test.ts` must still pass

**Interfaces:**
- Consumes: the Task 9 routes.
- Produces: `wizardReducer(state: WizardState, action: WizardAction): WizardState` exported from `components/import/wizard-state.ts` (pure, so it is unit tested), with steps `'upload' | 'match' | 'preview' | 'importing' | 'done'`.
- Behaviour:
  - **Upload:** "Coming from" select (Tally, Vyapar, Zoho Books, Other), the app's export instructions for this section, a file picker (`.xlsx,.csv`), and below it `ImportHistory` for this section with file name, date, counts, status and an "Undo import" button behind a confirm ("This removes the <n> records this import created. Records already used in a transaction are kept.").
  - **Match columns:** one line per file column: header, up to 3 sample values, a select of this section's fields plus "Don't import". A field already chosen for another column is disabled in the other selects. Required fields with no column are listed above the Next button, which stays disabled until they are matched. When `needsDateOrder`, one question: "Is 01-04-2026 the 1st of April or the 4th of January?" with day-first preselected.
  - **Preview:** three counts (Ready, Needs attention, Already exists) and the warning count; each unmatched value once with a select (states for `state`, the unit list for `unit`), re-running preview on change; the first 50 problem rows with row number and reasons; "Download problem rows"; an Import button labelled "Import <ready> <section label>", disabled when ready is 0 or the plan limit refuses (showing the limit message with a link to `/settings/subscription`).
  - **Importing:** calls commit repeatedly until `done`, showing `processed / total`. If a call fails, shows "Import paused at row <n>" with Resume. Leaving the page mid-import is safe; returning shows the run in history as unfinished with Resume.
  - **Done:** saved, skipped and failed counts, "Download problem rows" when any, "Undo import", and a link back to the list.
  - Each list page gets an "Import" button linking to `/import/customers`, `/import/suppliers`, `/import/items`, shown only to users with the module's `create` permission, styled like the page's existing secondary toolbar buttons.
  - Use the app's existing `Button`, toast and page-toolbar components; no new design tokens.
  - Register `/import/customers`, `/import/suppliers`, `/import/items` in `e2e/routes.json`, with titles "Import customers", "Import suppliers", "Import items" in `lib/breadcrumb-utils.ts` and `lib/mobile-route-title.ts`, following the entries added for `/reports/profit-loss/schedule-iii`.

- [ ] **Step 1: Write the failing reducer tests**: upload success moves to `match` with guesses; choosing a field for a column clears it from any other column; `match → preview` is refused while a required field is unmatched; a batch result with `done: false` stays on `importing` and updates progress; `done: true` moves to `done`; a failed batch sets `paused` with the row number.
- [ ] **Step 2: Run** `npx jest tests/lib/import/wizard-state.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the reducer, components, page, buttons and route registration; remove the old CSV input from the items page.
- [ ] **Step 4: Run** `npx jest tests/lib/import tests/lib/nav-active.test.ts` and `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(import): import wizard on customers, suppliers and items`.

---

### Task 11: Staging checklist and records

**Files:**
- Create: `docs/superpowers/plans/2026-11-10-move-to-khatario-import-plan-1-staging-checklist.md`
- Modify: `docs/roadmap.md` (the Move to Khatario card), `docs/project.log.md` (append)

- [ ] **Step 1: Write the checklist.** It starts with "Apply migration 470 on staging (owner approval) before deploying the code." and then lists, as numbered browser steps on `https://staging.khatario.com` with the expected result beside each: import a Tally ledger export as customers; a Vyapar party export as suppliers; a Zoho Books item export as items (each from a real export file supplied by the owner); a file with title lines above the header; a file with a bad GSTIN and a repeated phone, checking the preview counts; choosing a unit for an unmatched value; downloading problem rows; closing the tab mid-import and resuming; undo with one imported customer already invoiced; a staff user without create permission seeing no Import button; the old item CSV file still importing through the new screen.
- [ ] **Step 2: Run the full check**: `npx jest tests/lib/import` and, with the test database, `npx jest tests/db/import- tests/db/customer-services tests/db/supplier-services tests/db/item-services`. Expected: all PASS. Record the counts in the log entry.
- [ ] **Step 3: Update** the roadmap card (plan 1 built, next: staging with migration 470, then plan 2) and append the project log entry in the format in `docs/brain.md`.
- [ ] **Step 4: Commit** `docs: import plan 1 staging checklist` (the three files, by name).
