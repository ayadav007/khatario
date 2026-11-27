# e-Invoice (IRN) and e-way bills through Masters India

Status: planned, nothing built. Written 27 Nov 2026 from the two Masters India enterprise API PDFs
(`Einvoice API_EnterpriseDoc.pdf`, `EWB_API_EnterpriseDoc_Updated.pdf`, owner's Downloads folder; not
in the repo because the e-invoice PDF carries a sandbox username and password in plain text).

## Goal

Generate, cancel and manage e-way bills and e-invoices from Khatario instead of the government
portals. Plans already sell both: features `e_invoice` and `eway_bill` and limit
`max_eway_bills_per_month` (migration 360: free 0, growth 10, business unlimited). Today the user
generates them by hand and types the number back in.

Masters India is a GSP: one REST API in front of NIC's e-invoice (IRP) and e-way bill systems.
Sandbox: `https://sandb-api.mastersindia.co/api/v1/`.

## What already exists

| Piece | Where | Reuse |
| --- | --- | --- |
| E-way bill register, vehicle history | `eway_bills`, `eway_bill_vehicles` (migration 414) | Keep; add API columns |
| Lifecycle rules (cancel 24 h, extend ±8 h, max 4000 km, reject, close, Part B) | `lib/gst/eway-bill-records.ts`, `lib/gst/eway-bills.ts` | Keep the checks; call the API before writing |
| Register routes and page | `app/api/eway-bills/**`, `app/(app)/eway-bills/page.tsx` | Add "Generate" and API-backed actions |
| NIC bulk-upload JSON from invoice or challan | `lib/gst/eway-json.ts` | Basis of the Masters India payload; fix bugs below first |
| Manual e-way number on an invoice | `app/api/invoices/[id]/eway/route.ts`, `components/invoices/EwayBillField.tsx` | Keep for bills made elsewhere |
| Plan gate | `denyIfFeatureMissing(…, 'eway_bill')`, `lib/subscription/plan-path-gate.ts` | Add `e_invoice` gate on IRN routes |
| Encrypted per-business credentials | `business_integrations` (migration 476, courier plugins) | New provider `mastersindia` |
| Plugin page under Settings → Integrations | courier plugins Phase 1 | Same pattern for the GST plugin |
| E-invoicing applies alert (₹5 cr) | `lib/gst/compliance/checks.ts:460` | Point it at the new feature once built |
| IRN line on Bluetooth receipts | `lib/bluetooth/invoice-to-escpos.ts` | Feed it from the new columns |

Not present: any IRN, ack or signed-QR column; any outbound GSP call; enforcement of
`max_eway_bills_per_month` (defined, never checked).

## Masters India API facts that shape the design

- Auth: `POST token-auth/` with username and password returns a JWT; send `Authorization: JWT <token>`.
  Cache it per credential; re-login on 401 or auth error.
- Errors come back inside the body: `results.code: 204`, `status: "Failed"` or `"No Content"`,
  message often prefixed with an NIC code (`"3038: …"`, `nic_code`). HTTP status is not enough.
- Bulk endpoints are asynchronous (request id, then poll). Not needed for phase 1.
- Field names differ between the two APIs (`user_gstin` vs `userGstin`; state code `"09"` vs state
  name `"UTTARAKHAND"`; transport mode `"1"` vs `"Road"`). The PDF schemas contain typos and
  contradict the samples: build against sandbox behaviour and keep one fixture per endpoint.
- **E-way bill routing rule:** when the supplier is enabled for e-invoicing, B2B and export
  tax-invoice e-way bills are refused by the EWB API and must come from the IRN (in the generate
  IRN call, or `gen-ewb-by-irn/` afterwards). Challans, transfers, bills of supply and B2C
  invoices still use the EWB API.
- New since 15/06/2026: `ship_to_gstin` mandatory for transaction types 2 (Bill To – Ship To) and
  4; `URP` when unregistered. Voluntary closure endpoint `ewayBillClosure/`.

## Decisions

1. **One Khatario enterprise account at Masters India** (owner, 27 Nov 2026). Khatario's own
   Masters India username and password live in server env, never in the database. Customers never
   see a Masters India login.
2. **Khatario pays Masters India; customers pay Khatario through their plan.** The customer's
   only step outside Khatario is creating a free API user on the government portal. The cost per
   IRN or e-way bill has to be covered by plan prices and limits (see "Billing and limits").
3. **Per-GSTIN API credentials, entered by the customer** (the Vyapar pattern, seen in its
   "GSP Login" popup). For each GSTIN the customer logs in to the government portal and creates an
   API user for the GSP "Masters India Private Limited":
   - e-way bill portal: Registration → For GSP → Add/New (username gets a fixed prefix like
     `xxxx_API_`, password at most 15 characters);
   - e-invoice portal: API Registration → create API user through GSP (believed to offer reusing
     the e-way bill API credentials when the same GSP is registered; confirm before saying so in
     the help text).
   The customer types that API username and password into Khatario; Khatario passes them to
   Masters India for that GSTIN and verifies at once. No pending state, no admin queue.
4. **When the option appears.** "Generate e-invoice" on every B2B / SEZ / export / deemed export
   invoice, credit note and debit note of a GSTIN the business has marked as covered by
   e-invoicing (from a start date). E-invoicing depends on aggregate turnover, not invoice value;
   the existing ₹5 crore compliance alert asks the business to turn it on. "Generate e-way bill"
   when goods value is over ₹50,000, or whenever the user asks. The GSP login is asked at the
   moment of need (first click) and from Settings → Integrations.
5. **Production access.** Sandbox only until Masters India issues production credentials; the
   base URL is a per-environment setting, never hard-coded.

## Questions for Masters India (before Phase 1)

1. How does an enterprise account pass a client GSTIN's NIC API username and password (extra
   endpoint, headers or body fields)? The PDFs only show `user_gstin`. How do we verify them?
2. Pricing: per IRN, per e-way bill, per GSTIN, per API call (are GET, cancel and lookups billed?),
   or annual slabs? Minimum commitment?
3. Is one set of client credentials enough for both e-invoice and e-way bill APIs?
4. Production go-live steps, rate limits, uptime commitment, support contact.
5. Is the client password stored by Masters India after the first link, or must we send it on
   every call (decides whether Khatario stores it at all)?

## Billing and limits

- Khatario is billed by Masters India, so every billable call is a cost. Avoid needless calls: no
  polling, cache GSTIN lookups, verify credentials only on connect and reconnect.
- Add a `max_einvoices_per_month` limit beside the existing `max_eway_bills_per_month`, count only
  successful generations, and revisit "unlimited" on the business plan once the per-call price is
  known. Consider top-up packs for heavy users.
- Record each billable call (business, GSTIN, endpoint, result) in a small usage table so the
  Masters India invoice can be reconciled and abuse spotted.

## Phase 1: Masters India client and connection

- `lib/gsp/mastersindia/client.ts`: base URL from env (`MASTERSINDIA_BASE_URL`), login, token cache
  (in-process, keyed by credential, refresh before `exp`), `request()` that unwraps
  `results`, maps `code !== 200` to a typed `GspError { nicCode, message, retryable }`, and logs
  request ids without bodies (bodies carry party data).
- Khatario's enterprise credentials: server env only (`MASTERSINDIA_USERNAME`,
  `MASTERSINDIA_PASSWORD`).
- Customer credentials: `business_integrations` provider `gst_gsp`, one row per business;
  `config.gstins` lists each GSTIN with its NIC API username, status (`connected` | `failed`),
  e-invoicing start date and last verified time; passwords in `secrets_enc` keyed by GSTIN, same
  encryption as courier plugins (or not stored at all, per question 5). Never returned to the
  browser.
- Connect flow: GSTIN (picked from the business's registrations), API username, API password,
  Connect → verify through Masters India → Connected, or a plain reason (wrong password, API user
  not created, another GSP chosen). Reconnect when the password changes on the portal.
- Help panel with the two portal steps (see Decisions 3), linked from "Haven't created the API
  user?".
- Settings → Integrations → "GST e-invoice & e-way bill" page (connect, reconnect, disconnect,
  GSTIN cards, start dates), and the same connect popup shown on first "Generate" click.
- Tests: client unit tests against recorded sandbox responses (success, NIC error, auth expiry).

## Phase 2: e-way bills through the API

Fix `lib/gst/eway-json.ts` first (these bugs also affect today's bulk-upload JSON):
1. `transactionType` always 1. Work it out: Bill To ≠ Ship To → 2, Dispatch From ≠ Bill From → 3,
   both → 4; send `ship_to_gstin` / `ship_to_tradename` for 2 and 4.
2. Ship-to state comes from the customer's billing state; use the shipping state when the invoice
   ships elsewhere (customers have `shipping_state` but no shipping state code: add or derive).
3. Customer address is one text field, `addr2` always empty: split long addresses across both.
4. `cessNonAdvolValue` and `otherValue` hard-coded to 0: take them from the invoice (other charges,
   non-ad-valorem cess when present).
5. `docNo` silently cut to 16 characters: refuse instead, with a message naming the limit.

Then:
- `lib/gsp/mastersindia/eway.ts`: map the parsed bill to the Masters India generate payload; wrap
  cancel, Part B (`updateVehicleNumber/`), extend, transporter update, reject, closure, get.
- Migration: on `eway_bills` add `generated_via` (`manual` | `api` | `irn`), `gsp_request_id`,
  `print_url`, `last_synced_at`; nothing else changes shape.
- `createEwayBill` / `updateEwayBill`: when the business is connected and the user picks
  "Generate", call the API first, then write the register in the same transaction only on
  success; manual entry stays as today.
- Routing guard: refuse API generation for B2B or export tax invoices of an e-invoicing GSTIN and
  send the user to "Generate IRN with e-way bill" (Phase 3).
- Enforce `max_eway_bills_per_month` on generation (`lib/subscription/limit-registry.ts`), counting
  API-generated bills only.
- Distance: offer the Distance API (`distance/`) and allow 0 ("use the portal's distance").
- UI: Generate button on invoice, challan and transfer pages and on `/eway-bills`; show NIC errors
  in plain words; print link.

## Phase 3: e-invoice (IRN)

- Migration on `invoices`, `credit_notes`, `debit_notes`: `irn`, `irn_ack_no`, `irn_ack_date`,
  `irn_signed_qr`, `irn_signed_invoice` (text), `irn_status` (`active` | `cancelled`),
  `irn_cancelled_at`, `irn_cancel_reason`. Unique `(business_id, irn)`.
- `lib/gsp/mastersindia/einvoice.ts`: payload builder (sharing seller, party and line helpers
  with `eway-json.ts`), generate, cancel, get by IRN, get by document, generate EWB by IRN.
- Pre-checks with clear messages: B2B / SEZ / export / deemed export only (never B2C); document
  number ≤ 16 characters, not starting with `0`, `/` or `-`; HSN on every line; UQC on goods;
  totals within the ₹1 tolerance and round-off within ±99.99; at most 1000 lines.
- Lifecycle:
  - Generate from a final invoice; optional transport details create the e-way bill in the same
    call (`generated_via = 'irn'`).
  - With an active IRN the invoice cannot be edited or amended
    (`app/api/invoices/[id]/amend/route.ts`); the only way out is cancel within 24 hours, refused
    while an active e-way bill exists.
  - Cancelling the IRN offers to cancel the Khatario invoice too (existing cancel path,
    `lib/invoices/cancel-invoice-accounting.ts`); cancelling the invoice cancels the IRN first.
  - A cancelled IRN's document number cannot be reused: numbering must never hand it out again.
- Replace the "Khatario does not create the IRN" notes (`ComposerDetails.tsx:374`,
  `EwayBillField.tsx:121`) and update the compliance alert.

## Phase 4: printing and phone app

- IRN, ack number and date, and the signed QR (rendered as a QR image) on every A4 and thermal
  template, credit and debit notes included; template field audit test extended.
- Phone app: show IRN status and e-way bill details; generate actions after the web version is
  proven on staging.

## Testing

- Unit: payload builders against fixtures (intra-state, inter-state, export, SEZ, Bill To – Ship To,
  CESS, bill of supply, challan, stock transfer), tolerance checks, routing guard.
- DB tests on `kh_phase2_test`: register writes only after a successful (mocked) GSP call; IRN lock on
  amend; limit enforcement.
- Sandbox: a manual checklist on staging with the sandbox credentials from the owner (kept in
  `.env`, never committed).

## Risks

- PDF and sandbox disagree: keep fixtures from real sandbox responses and test against those.
- GSP outage or slow NIC: generation must never leave a half-written invoice; the API call happens
  before the database write, and a timeout shows "check status" (get by document) instead of
  retrying blindly, since a retry can create a duplicate.
- Party data quality (missing pincode, state code, HSN) will surface as NIC errors: validate
  before calling and say which master record to fix.
