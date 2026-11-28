# e-Invoice (IRN) and e-way bills through Masters India

Status: Plan 1 and Plan 2 built, reviewed task by task, not deployed (see the status sections at the end). Written 27 Nov 2026 from the two Masters India enterprise API PDFs
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

## Decisions (revised 27 Nov 2026 after Masters India's reply)

Masters India confirmed the PDFs are complete. They define one way in: `token-auth/` with a
**Masters India account** login, then `user_gstin` on each call. A taxpayer's government-portal
API credentials are never sent through the API; they are linked to the GSTIN inside Masters
India when the GSTIN is added to an account. An earlier draft of this section said Khatario would
pass those portal credentials through the API. That was wrong.

1. **Each business connects its own Masters India account** (the Vyapar pattern: its "GSP Login"
   popup asks for the Masters India username and password, "different from e-way bill / e-invoice
   / GST portal credentials"). The owner first chose "one Khatario account"; that model has no
   documented way to add a customer's GSTIN except by hand in Masters India's dashboard, so the
   plans build the per-business model. **Confirmed by the owner, 27 Nov 2026.** Switching later is one function:
   `loadGspCredentials` (Plan 1, Task 2) returns the env login instead of the stored one.
2. **Who pays.** With per-business accounts the customer's commercial relationship is with
   Masters India unless a partner deal says otherwise; Khatario gates the feature by plan.
   Pricing, partner terms and production go-live are not in the PDFs and are still open with
   Masters India.
3. **What the customer does once, outside Khatario.** Sign up with Masters India, add the GSTIN
   there, and on the government portals create an API user for the GSP "Masters India Private
   Limited" (e-way bill portal: Registration → For GSP; e-invoice portal: API Registration).
   Then enter the Masters India login in Khatario; Khatario verifies it with `token-auth/`.
4. **When the options appear.** "Generate e-invoice" on every B2B / SEZ / export / deemed-export
   tax invoice of a GSTIN the business has marked as covered by e-invoicing from a start date
   (turnover rule, not invoice value). "Generate e-way bill" on final invoices and delivery
   challans with goods; the UI suggests it when goods value is over ₹50,000. The connection is
   asked for at the first click and from Settings → Integrations.
5. **Environment.** `MASTERSINDIA_BASE_URL` per environment; production refuses to start a call
   without it, so a production server can never talk to the sandbox by accident.

## Limits

- Enforce `max_eway_bills_per_month` (exists, never checked) and add `max_einvoices_per_month`.
  Count only successful API generations.
- No polling, no repeated lookups: a call is made only on a user action.

## Implementation plans

| Plan | Scope | File |
| --- | --- | --- |
| 1 | Masters India client, connection page, e-way bills generated and managed through the API, monthly limit | `docs/superpowers/plans/2026-11-27-gsp-connection-eway-bills.md` |
| 2 | E-invoice for sales invoices: IRN generate and cancel, invoice lock, e-way bill through the IRN, IRN and QR on the printed invoice | `docs/superpowers/plans/2026-11-27-e-invoice-irn.md` |
| 3 (not written) | IRN for credit and debit notes, IRN block audited on every template and thermal print, phone app, "generate on finalise" setting, stock-transfer e-way bills through the API | to be planned after 1 and 2 are on staging |

## Known gaps in the data (accepted for now)

- Non-ad-valorem cess is not stored on invoice lines; `cessNonAdvol` stays 0.
- An invoice has one customer and a free-text shipping address, so a "ship to" party is the same
  customer at another address unless the user types a different ship-to GSTIN when generating.

## Testing

- Unit tests with a fake `fetch` and fixtures recorded from the sandbox.
- DB tests only on `kh_phase2_test`, with the GSP call injected.
- A manual staging checklist at the end of each plan, run against the sandbox.

## Risks

- PDF and sandbox disagree (schema typos, enum spellings): Plan 1 Task 1 records real sandbox
  responses first and every later task tests against those.
- Slow or failed GSP call: the API call happens outside any database transaction; on a timeout
  the code looks the document up once (by document number) before reporting failure, because a
  blind retry can create a duplicate.
- Party data quality (missing pincode, state code, HSN): checked before calling, with a message
  naming the record to fix.

## Plan 1 status (27 Nov 2026): built, reviewed, not deployed

18 commits on main, `64345163` to `19b7713a`, not pushed. Migration `477_eway_bills_gsp.sql` written and applied to
the disposable test database only. Staging steps:
`docs/superpowers/plans/2026-11-27-gsp-connection-eway-bills-staging-checklist.md`. **Deploy order: migration 477
before the code**, because even a hand-typed e-way bill now writes the new columns.

What the sandbox showed (recorded in `tests/fixtures/gsp/`):
- A second generate for the same document number is not rejected: it returns the existing bill with an alert.
  Khatario checks that bill's document number, date and status before recording it.
- After a cancel, generating again on the same document number returns a new bill number.
- The sandbox is lenient about spellings, so acceptance there does not prove the live system agrees.

### Before production (open)

1. Double clicks: two quick clicks on an action can send two portal requests. For cancel and close the second is
   refused; for extend it may be accepted. Needs a row claim (a `pending_action` column, so a migration).
2. Confirm on the live service: whether a repeated document number is rejected (NIC 604) or returns the existing bill;
   whether a cancelled document number can be reused; the cancel reasons other than "Others"; the over-dimensional
   vehicle type; the Part B request shape; extend (never run against the sandbox).
3. Close recovery treats a blank or unknown portal status as closed (`lib/gst/eway-gsp-actions.ts`); treat it as
   unknown and pass the portal's refusal on.
4. `otherValue` should carry the difference between the invoice total and its lines; the plan limit check and the
   insert are not atomic (concurrent generates can go one over); BH-series vehicle plates are refused by the form;
   date displays do not pin `Asia/Kolkata`.
5. Tests still missing: HTTP-level tests of the two routes; `buildEwayBill` on challan, supplier and transfer paths;
   the 16-character refusal for challans. Screens were type-checked only, never seen in a browser before staging.
6. A broken connection can be returned to the pool after a failed ROLLBACK (`release()` without the error); this
   pattern predates this work.
7. Masters India: pricing, partner terms, production URL and go-live.

### Unrelated failures seen during the build (not caused by this work, not fixed)

`tests/lib/gst/return-helpers.test.ts` (3 tests on `balance_amount`), a `capability-normalizer` test, and
`invoice-audit-coverage` flagging `app/api/stock-transfers/[id]/dispatch/route.ts`. The final review confirmed by
reading imports that nothing in this range can cause them; nobody ran them on the commit before this work.

## Plan 2 status (28 Nov 2026): built, reviewed task by task, not deployed

12 commits on main, `17b1468a` to `1f184f4b`, not pushed. Migration `478_einvoice_irn.sql` (IRN columns on `invoices`, `einvoice_from` on businesses and branches, the `max_einvoices_per_month` limit) written and applied to the disposable test database only. Staging steps:
`docs/superpowers/plans/2026-11-27-e-invoice-irn-staging-checklist.md`. **Deploy order: migration 478 before the code**, applied by a person with the owner's approval. The migration builds a unique index on `invoices` with a plain `CREATE UNIQUE INDEX`, which blocks invoice writes while it builds: apply it at a quiet time, or split that statement out as `CREATE UNIQUE INDEX CONCURRENTLY` for production. Every plan with the `e_invoice` feature gets an unlimited monthly count for now (the feature gate is the real control until Masters India pricing is known). The final whole-branch review was still to run when this was written; it will be noted here after it.

What the sandbox showed (recorded in `tests/fixtures/gsp/`, 10 of 12 allowed calls used):
- The e-invoice sandbox GSTIN needs a 6-digit HSN (NIC rule 2311, for turnover of 5 crore and above). The builder checks for 6 or 8 digits before calling.
- A repeated document is not rejected: it returns the same IRN with an alert, `IRN already generated on this document number`. Khatario detects a repeat from that text and stores the IRN only when the portal's copy matches this invoice's number, date and seller GSTIN and is active.
- Some fields are missing from replies: no PDF link or request number on a get-by-document, no request number on an e-way bill by IRN, and the details field is empty on every call, so the partial-success case (IRN issued, e-way part failed) is tested only with a made-up body.
- A seller PIN code of 999999 is refused (2276); a missing document is code 2154.

### Before production (open)

1. Confirm on the live portal: whether a repeated document is refused (code 2150 is assumed, never seen) or returns the existing IRN; all four cancel reason codes (one was tried); whether the e-way bill made through the IRN carries the ship-to address (the app sends only distance and transport details); whether a cancelled invoice number can be reused (the app refuses it before asking).
2. Scan the printed QR with the government's verification app. It holds about a thousand characters, drawn 30 mm on paper and 132 px on screen; scan-ability was never checked. The 30 mm block layout on each template was never seen in a browser either.
3. Product decision for the owner: amending an invoice is allowed once its e-invoice is cancelled. Decide whether that should stay.
4. Printing: credit note, debit note, delivery challan, work order and the other templates do not print the IRN. The seven A4 sales templates, tally, distributor, export, bill of supply and the two thermal templates do. Plan 3 audits the rest.
5. Double clicks and limits: there is no in-flight claim, so two quick requests (two tabs) make two portal calls and a second history entry, and the monthly limit can be passed by requests in flight. The panel itself greys its buttons while a request runs.
6. Empty e-way number: `PATCH /api/invoices/[id]/eway` accepts an empty number and clears the invoice's number even while an API-made bill is active in the register. The screen no longer sends it by mistake, but the server has no guard (predates this work).
7. Recovery gaps: on a retry where the repeated result has no e-way part, an e-way bill the portal already issued is not recorded, and the warning says the portal did not say why; a recheck after 24 hours stores the time of the check, not the portal's cancel time; a rejected cancel looks the document up again on every refusal until the "already cancelled" codes are confirmed.
8. Smaller code items: a goods quantity under 0.0005 rounds to 0 in the payload; a typed export ship-to place, PIN and state are not validated by the builder; document types are excluded by a deny-list, not an allow-list; the closed-branch start date still resolves; `miGenerateEwbByIrn` accepts an empty `EwbNo`; the same wording is repeated in two files; the panel is mounted twice on the view page (4 to 6 extra requests per view); Fix links have no return target and no accessible names; no component-level test of the panel; some database tests depend on order and shared state; route tests mock authorization and the plan gate.
9. Screens were type-checked only and never seen in a browser. Masters India pricing, partner terms, production URL and go-live are still open.
