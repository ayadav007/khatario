# QA: New Invoice — desktop composer actions

**Scope:** `/invoices/new` **new desktop composer only** (not classic form, mobile layout, or POS).  
**Depth:** Happy path + validation / edge cases per action.  
**Automation:** Case IDs map to `e2e/invoice-new-composer-actions.spec.ts`. Run:  
`npm run test:e2e -- e2e/invoice-new-composer-actions.spec.ts`  
**Prerequisites:** Logged-in user with billing access, business profile state set, document series ready, at least one warehouse when stock items are used. Viewport ≥ 1024px; `localStorage.invoiceClassicDesktop` must **not** be `'1'`.

**Record for each case:** Pass / Fail / Blocked · notes · screenshot on fail.

### Automation status (desktop composer)

| Automated in Playwright | Manual-only (fixture / binary / env-heavy) |
|-------------------------|--------------------------------------------|
| H-01 H-03* H-04 H-05 | H-02 |
| D-01 D-02 D-05 | D-03 D-04 D-06 D-07 |
| C-01 C-03 C-05 C-06 C-10 | C-02 C-04 C-07 C-08 C-09 C-11 C-12 |
| DET-01 DET-02 DET-03 DET-06 | DET-04 DET-05 DET-07 |
| MORE-01 N-01 N-02 | MORE-02..06 N-03 |
| EXP-01 EXP-02 EXP-03 | EXP-04 EXP-05 EXP-06 |
| I-01 I-02 I-06 I-07 I-08 I-09 I-11 I-12 I-13 | I-03 I-04 I-05 I-10 I-14 I-15 |
| T-02 T-03 T-04 | T-01 T-05 |
| P-01 P-02 P-03 P-05 P-08 P-09 | P-04 P-06 P-07 |
| F-01 F-02 F-03 F-04 F-08 | F-05 F-06 F-07 F-09 F-10 F-11 |
| K-01 K-02 K-03 K-05 K-06 | K-04 K-07 K-08 K-09 |
| M-04 | M-01 M-02 M-03 M-05 M-06 M-07 · B-01..B-06 |

\*H-03 automates only when dirty detection fires for search text; otherwise mark manually.

---

## How to read IDs

| Prefix | Section |
|--------|---------|
| H | Header / navigation |
| D | Document type / entry mode |
| C | Customer / parties |
| DET | Invoice details |
| MORE | More details / attachments |
| EXP | Export & shipping |
| I | Items / picker / GST-inclusive |
| T | Totals / charges / round-off |
| P | Payments |
| N | Notes |
| F | Footer save / preview / share / print |
| K | Keyboard shortcuts |
| M | Modals / guards |
| B | Banners / soft warnings |

---

## H — Header / navigation

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| H-01 | Page opens as new composer | Open `/invoices/new` on desktop with classic preference cleared | Title **New Tax Invoice** (or BOS/Estimate per GST); **Classic form** and **?** visible; Bill to / Items / footer Save draft | If classic preference set → classic UI (out of scope); clear key and retest |
| H-02 | Back clean | Click **Back** with empty form | Leaves composer (e.g. invoices list); no discard dialog | — |
| H-03 | Back with dirty form | Edit any field, click **Back** | Unsaved dialog: Stay / Leave without saving | Stay keeps data; Leave discards |
| H-04 | Switch to classic | Click **Classic form** | Classic form; preference persisted | Switch back via “new invoice form”; preference cleared |
| H-05 | Shortcuts help | Click **?** | Shortcuts dialog lists F2–F9, Ctrl+S, etc. | Esc / close dismisses; `?` toggles when not typing |

---

## D — Document type / entry mode

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| D-01 | Tax invoice default | Open `/invoices/new` (regular GST) | Tax invoice composer; GST columns; payment block | — |
| D-02 | Proforma / estimate | Open `/invoices/new?type=proforma_invoice` | Title Estimate; no payment UI; **Save** / **Save & send** | Payment F8/F9 inactive |
| D-03 | Bill of supply | Open as composition / `?type=bill_of_supply` | No GST columns; BOS messaging | Prices include GST toggle hidden |
| D-04 | Edit draft | Open `/invoices/new?edit=<draftId>` | Loads customer, lines, dates; editable | Wrong id → error / empty with message |
| D-05 | Prefill customer | `/invoices/new?customer_id=<id>` | Customer selected on load | Invalid id → search empty, no crash |
| D-06 | Convert estimate | `/invoices/new?convert_from=<proformaId>` | Lines/customer copied into new tax doc | Converted estimate not re-editable as estimate |
| D-07 | Type switch while dirty | Start tax invoice, dirty, navigate to `?type=proforma_invoice` | Discard dialog: Save Draft & Switch / Discard & Switch / Stay | Stay keeps type + data |

---

## C — Customer / parties

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| C-01 | Search and select | Focus Bill to, type name, pick customer | Bill to filled; shipping/POS from customer; focus moves toward items | No matches → create prompt |
| C-02 | Cash sale (no customer) | Leave customer empty, add item, save draft | Draft saves without customer | Final may still allow walk-in per product rules |
| C-03 | Clear customer | Select customer → clear / remove | Returns to search; addresses cleared | — |
| C-04 | Change customer (F2) | Select → **Change** or F2 | Search reopens; can pick another | Overseas → Export auto; India → Domestic |
| C-05 | Create customer from search | Type unique name → **Create “…”** / **Add new customer** | Create Customer modal; on save, customer selected | Cancel leaves search open |
| C-06 | Edit billing address | **Address** → edit → blur/done | Invoice-only billing text updates; customer master unchanged unless product says otherwise | Empty address allowed |
| C-07 | Edit shipping | Ship to **Change address** → edit → **Done** | Shipping updates | — |
| C-08 | Use billing address | Edit ship ≠ bill → **Use billing address** | Ship matches bill | — |
| C-09 | Use saved shipping | After override → **Use saved shipping address** | Restores customer shipping | Hidden if no saved shipping |
| C-10 | Place of supply | Change POS state vs seller state | Tax badge CGST+SGST ↔ IGST; totals update | Export locks POS to “Other country” |
| C-11 | Credit warning | Select customer over/near credit limit | Credit banner/warning visible | Does not block draft unless product enforces |
| C-12 | Overseas customer | Select customer with non-India country | Auto **Export**; toast | Clearing to Indian customer switches Domestic |

---

## DET — Invoice details

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| DET-01 | Series number visible | Open new composer | Read-only doc number or loading / “Number not ready” | Series missing → save blocked with clear error |
| DET-02 | Invoice date | Change Date | Date updates; future date shows warning | Future date warning does not always block |
| DET-03 | Payment terms chips | Click **15 days** / **30** / **45** / **No credit** | Due date = invoice date + N; No credit clears due | Changing invoice date then re-click term recalculates |
| DET-04 | Due date manual | Set Due date via date input | Terms chip may deselect if not exact match | Due before invoice date blocked (`min`) |
| DET-05 | Warehouse | Change warehouse select | Selected warehouse used for stock | No warehouses → warning banner |
| DET-06 | Domestic / Export toggle | Click **Export** then **Domestic** | Export panel appears/hides; toast; Alt+E toggles | Domestic clears export-only fields |
| DET-07 | Custom fields | Fill required custom fields if configured | Values included on save | Required empty → save validation error |

---

## MORE — More details / attachments

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| MORE-01 | Expand more details | Open PO / e-way / references section | Fields editable | Collapsed by default unless values exist |
| MORE-02 | PO + e-way | Fill PO no/date, e-way no/date | Persist on draft save | Invalid dates handled gracefully |
| MORE-03 | Dispatch fields | Fill delivery note, dispatched through, destination, terms | Persist on draft | — |
| MORE-04 | Attach files | **Attach files** → choose file(s) | Files listed with name/size | Upload failure shows error; retry OK |
| MORE-05 | Open attachment | Click attachment link | Opens in new tab / download | — |
| MORE-06 | Remove attachment | Remove control on file | File removed from list | Confirm not required |

---

## EXP — Export & shipping (Export on)

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| EXP-01 | Under LUT | Export on → **Under LUT** | IGST 0%; tax rows reflect 0 | Hidden for bill of supply |
| EXP-02 | IGST paid | **IGST paid** | IGST charged on lines | Toggle back to LUT zeros tax |
| EXP-03 | Foreign currency | Currency USD + exchange rate | Total shows FX approx | Rate 0 / missing → no FX or invalid save |
| EXP-04 | Port & shipping bill | Fill port code, shipping bill no/date | Values retained | Soft hint if missing for GSTR-1 |
| EXP-05 | Buyer tax ID | Enter buyer VAT/tax id | Retained | — |
| EXP-06 | Transport expand | Expand ports/incoterms/transport | Transport mode, AWB/BL, incoterms, ports, place of delivery, origin | Collapse keeps values |

---

## I — Items

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| I-01 | Open picker | **Add items** or F3 | Modal **Add items** | Esc / Cancel closes without adding |
| I-02 | Search and add one | Search → Enter / ADD+ → **Add N to bill** | Line appears with qty/price/tax | Empty catalog → create item path |
| I-03 | Add multiple | Select several qty → Add to bill | Multiple lines or merged qty per item rules | Shift+Enter remove from selection |
| I-04 | Create item from picker | **Create new item** | Create Item modal; item then addable | Cancel returns to picker |
| I-05 | Variants | Item with variants → **Choose** → add | Correct variant on line | Cannot add without choosing if required |
| I-06 | Barcode add | Focus barcode (F4), enter code + Enter | Matching item added | Unknown code → toast/error, no blank line |
| I-07 | Edit HSN / qty / price | Edit cells | Amount and tax recalculate | Qty 0 → line amount 0; negative blocked/clamped |
| I-08 | Discount % | Enter discount % | Discount amount + totals update | >100% rejected or capped |
| I-09 | Discount ₹ | Toggle %/₹ → enter amount | Discount in ₹; totals update | Discount > line value handled |
| I-10 | GST % change | Change line tax rate | Tax + grand total update | Hidden for BOS / LUT zero-rate |
| I-11 | Prices include GST ON | Toggle **Prices include GST** | Header **Price (incl. GST)**; line tax extracted from inclusive price | Toggle OFF reverses treatment |
| I-12 | Prices include GST OFF | Toggle off after inclusive | Exclusive prices; tax added on top | Catalog `gst_included` items convert on add |
| I-13 | Remove line | Trash / Ctrl+Del | Line removed; totals update | Removing last line → empty items OK for draft |
| I-14 | Keyboard cell nav | Enter / ↑↓ in qty→price→discount | Focus moves as designed | From last cell Enter returns to Add items |
| I-15 | No price warning | Add item with 0 price | **No price set** warning on row | Save draft may still work; final may warn |

---

## T — Totals / charges / round-off

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| T-01 | Taxable + GST split | Intra-state invoice with lines | Taxable, CGST, SGST, Total amount | Inter-state → IGST only |
| T-02 | Additional charges | **Additional charges** → purpose + amount | Grand total increases | Empty purpose with amount still adds |
| T-03 | Remove charge | Remove charge | Total decreases | — |
| T-04 | Round off ON | Enable **Round off** | Round-off ± shown; grand nearest rupee | Toggle off restores unrounded |
| T-05 | Amount in words | Any positive total | Words under total (INR) | Export FX may replace words with FX line |

---

## P — Payments (tax invoice / BOS; not proforma)

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| P-01 | Amount received | Enter partial amount (F8) | Balance due = total − paid | 0 clears payment |
| P-02 | Fully paid | Check **Fully paid** / F9 | Paid = grand; balance 0; “Fully paid” | F9 again clears if already full |
| P-03 | Payment mode | Click UPI / Card / Bank / Cheque / Cash | Mode selected on payment | Default cash |
| P-04 | Overpay | Received > total | “Received more than total” state | — |
| P-05 | Split payment modal | **Split payment, date or reference** | Payment modal opens | Save updates list; Cancel discards modal edits |
| P-06 | Full / 50% presets | In modal: Full / 50% | Amount filled accordingly | — |
| P-07 | Add another payment | Add second split | Multi-payment summary on composer | Edit payments reopens modal |
| P-08 | Hidden on estimate | Open proforma | No Amount received / Fully paid | — |
| P-09 | Disabled until total | Fully paid with empty items | Checkbox disabled while grand ≤ 0 | — |

---

## N — Notes

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| N-01 | Reveal notes | **Add notes or terms printed on the invoice** | Textarea appears | — |
| N-02 | Edit notes | Type terms | Persists on draft/final | Very long text accepted or truncated with notice |
| N-03 | Notes on print/PDF | Save → Preview/PDF | Notes appear on document | Empty notes section omitted |

---

## F — Footer actions

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| F-01 | Preview | Customer + item → **Preview** | Preview modal/iframe | Ctrl+P same when not final; empty may still preview or warn |
| F-02 | Save draft | **Save draft** / Ctrl+Shift+S | Draft saved; editable; status Draft | Offline → sync messaging if applicable |
| F-03 | Save invoice (final) | **Save invoice** / Ctrl+S | Finalised; GST messaging; read-only composer | Missing required fields → inline/toast errors |
| F-04 | Save estimate | Proforma → **Save** / **Save & send** | Estimate saved; no GST finalisation copy | — |
| F-05 | Print after save | After save → **Print** | Print flow | Final: Ctrl+P prints |
| F-06 | PDF after save | **PDF** | Download/open PDF | Amounts match UI |
| F-07 | Share when final | Final → **Share** | Share modal (WA / email / link / PDF) | Hidden while draft-only if product requires final |
| F-08 | New invoice after final | Read-only → **New invoice** | Fresh empty composer | Estimate → **New estimate** |
| F-09 | Save without series | Block series / no branch | Save fails with clear message | — |
| F-10 | Profile gate | Incomplete business profile | Gate before save/print | Completing profile unblocks |
| F-11 | Invoice limit / upgrade | Hit plan invoice limit | Upgrade modal | Close returns without save |

---

## K — Keyboard shortcuts

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| K-01 | F2 | Press F2 | Customer search focused | Ignored when read-only / modal open |
| K-02 | F3 | Press F3 | Item picker opens | — |
| K-03 | F4 | Press F4 | Barcode field focused | — |
| K-04 | F8 | Press F8 (tax invoice with total) | Amount received focused | No-op on estimate |
| K-05 | F9 | Press F9 | Fully paid toggles | No-op if grand ≤ 0 |
| K-06 | Alt+E | Press Alt+E | Export toggles | — |
| K-07 | Ctrl+S | Press Ctrl+S | Final save | Shift+Ctrl+S → draft |
| K-08 | Ctrl+P | Draft → Ctrl+P | Preview | After final → Print |
| K-09 | ? help | Press `?` outside inputs | Shortcuts dialog | Ignored while typing in input |

---

## M — Modals / guards

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| M-01 | Preview close | Open preview → Close | Returns to composer; data intact | — |
| M-02 | Share actions | Final → Share → Copy link / Download PDF / Email / WhatsApp | Each action works or shows connect prompt | Create Another Invoice resets |
| M-03 | Create customer modal | From Bill to create | Required name validation; success selects customer | Duplicate phone rules enforced |
| M-04 | Create item modal | From picker create | Required fields; item appears in picker | — |
| M-05 | Unsaved leave | Dirty → navigate away | Stay / Leave without saving | Browser refresh may use beforeunload |
| M-06 | Type-switch discard | See D-07 | Three options behave as labeled | — |
| M-07 | Payment modal cancel | Open split → edit → Cancel | Composer payments unchanged | — |

---

## B — Banners / soft warnings

| ID | Case | Steps | Expected | Edge / validation |
|----|------|-------|----------|-------------------|
| B-01 | GSTR-1 locked | Open filed-period invoice | Locked banner; read-only | Print/PDF/Share still if already saved |
| B-02 | Composition → BOS | Composition GST business | BOS messaging on composer | — |
| B-03 | Credit warning | See C-11 | Banner visible | — |
| B-04 | No warehouses | Business with zero warehouses | Warning; stock items may fail on final | — |
| B-05 | Future invoice date | Set future Date | Amber “Date is in the future” | — |
| B-06 | Series not ready | Break series config | Number not ready; save blocked | — |

---

## Suggested smoke path (manual)

1. H-01 → C-01 → I-02 → I-11 → DET-03 → P-02 → N-01 → F-01 → F-02 → F-03 → F-06 → F-07 → F-08  
2. Export path: DET-06 → EXP-01 → I-02 → F-02  
3. Estimate path: D-02 → C-01 → I-02 → F-04  

---

## Out of scope (this doc)

Classic desktop form, mobile invoice UI, POS mode, purchase bills, credit/debit notes, and post-save invoice detail page actions beyond Print/PDF/Share/New from the composer footer.
