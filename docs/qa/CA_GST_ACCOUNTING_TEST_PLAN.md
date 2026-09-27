# CA review: GST and accounting test plan (staging)

**Target:** `https://staging.khatario.com` (never production)
**Tester role:** Senior Chartered Accountant reviewing the product before customers file returns from it
**Business:** QA Trial Traders, Pune, Maharashtra (state 27), GSTIN `27AAQCT1234A1ZL`, regular taxpayer
**Period under test:** September 2026 (FY 2026-27). GST rates follow the September 2025 rationalisation (0 / 0.25 / 3 / 5 / 18 / 40 %).
**Test data prefix:** `CA-` on every item, party and note, so it can be told apart from earlier QA data.

Result for every case: **Pass / Fail / Partial / Blocked / N/A**, with the figure seen vs the figure expected.

---

## Test masters

### Parties

| Code | Name | Type | GSTIN | State | Purpose |
|---|---|---|---|---|---|
| C1 | CA-Shreeji Furnishers | Customer, registered | `27AAPFU0939F1ZV` | Maharashtra 27 | Intra-state B2B |
| C2 | CA-Bengaluru Tech Pvt Ltd | Customer, registered | `29AABCT1332L1ZA` | Karnataka 29 | Inter-state B2B, TDS 194J deductor |
| C3 | CA-Rakesh Shah | Customer, unregistered | — | Gujarat 24 | B2C Large (inter-state, invoice > ₹1,00,000) |
| C4 | CA-Walk-in Pune | Customer, unregistered | — | Maharashtra 27 | B2C Small |
| C5 | CA-Global Imports LLC | Customer, overseas | — | Other country (96) | Export under LUT |
| S1 | CA-Deccan Steel Works | Supplier, registered | `27ABCPD1234E1ZE` | Maharashtra 27 | Intra-state purchase, ITC CGST+SGST |
| S2 | CA-Karnataka Rice Mills | Supplier, registered | `29AAFCD5862R1ZR` | Karnataka 29 | Inter-state purchase, ITC IGST |
| S3 | CA-Adv. Mehta & Associates | Supplier, advocate | — | Maharashtra 27 | Legal service under reverse charge |

### Items

| Code | Name | HSN/SAC | Rate | Price | Notes |
|---|---|---|---|---|---|
| I1 | CA-Steel Almirah | 94032010 | 18% | ₹10,000 | Goods |
| I2 | CA-Basmati Rice 25kg | 10063020 | 5% | ₹1,500 | Goods |
| I3 | CA-Consultancy Service | 998311 | 18% | ₹20,000 | Service (SAC) |
| I4 | CA-Fresh Vegetables | 07020000 | 0% (nil) | ₹500 | Nil-rated |
| I5 | CA-Gold Ring | 71131910 | 3% | ₹50,000 | Special rate |
| I6 | CA-Pen Refill | 96089100 | 18% | ₹99.99 | Rounding test |
| I7 | CA-Soft Drink 250ml | 22021010 | 40% | ₹100 | New sin-goods slab |

---

## Phase 1 — Setup and masters

| ID | Case | Expected (law / practice) |
|---|---|---|
| M1 | Business profile GST fields | GSTIN checksum validated; state auto-derived from first 2 digits; PAN derived from GSTIN chars 3–12; registration type (Regular / Composition) selectable |
| M2 | Customer GSTIN validation | Invalid checksum rejected (try `27AAPFU0939F1ZX`); state auto-filled from GSTIN; PAN derivable |
| M3 | GSTIN–state mismatch | GSTIN `29…` with state Maharashtra → warning or block |
| M4 | HSN validation | Accepts 4/6/8-digit HSN and 6-digit SAC (99xxxx); flags invalid; guidance for turnover-based digits (4 digits ≤ ₹5 cr, 6 digits > ₹5 cr) |
| M5 | GST rate list | Offers 0, 0.25, 3, 5, 18, 40. Flags or hides abolished 12% and 28% for new items |
| M6 | Cess | Compensation cess field exists for legacy tobacco-type goods; not forced on 40% slab items |
| M7 | Financial year | FY runs 1 April – 31 March; books-beginning date configurable |
| M8 | Opening balances | Party opening balances and ledger opening balances post to the trial balance and balance |

## Phase 2 — Outward supplies (sales)

Expected figures are computed by hand. Tax per line = taxable × rate, rounded to paise.

| ID | Invoice | Lines | Expected |
|---|---|---|---|
| S1 | Intra B2B to C1 | 2 × I1 @ ₹10,000 less 10% trade discount; 10 × I2 @ ₹1,500 | Taxable ₹33,000 (18,000 + 15,000). CGST ₹1,995 (1,620 + 375), SGST ₹1,995. Total ₹36,990.00. No IGST |
| S2 | Inter B2B to C2 | 1 × I3 @ ₹20,000 | IGST 18% ₹3,600, total ₹23,600. POS Karnataka (29). No CGST/SGST |
| S3 | B2C Large to C3 | 11 × I1 @ ₹10,000 | Taxable ₹1,10,000, IGST ₹19,800, total ₹1,29,800. POS Gujarat (24). Customer address mandatory (Rule 46(p)) |
| S4 | B2C Small to C4 | 1 × I2 @ ₹1,500 | CGST ₹37.50, SGST ₹37.50, total ₹1,575 |
| S5 | Rounding to C4 | 3 × I6 @ ₹99.99 | Taxable ₹299.97; tax ₹53.99 (CGST ₹27.00 + SGST ₹27.00 = ₹54.00 if rounded per head); round-off shown separately; invoice total rounds to rupee only via a Round Off line |
| S6 | Nil-rated to C4 | 1 × I4 @ ₹500 | No tax; reported as nil-rated in GSTR-1 Table 8 and 3B 3.1(c) |
| S7 | Special rate to C1 | 1 × I5 @ ₹50,000 | CGST 1.5% ₹750, SGST 1.5% ₹750, total ₹51,500 |
| S8 | Tax-inclusive price to C4 | 1 × I1 at inclusive ₹11,800 | Taxable ₹10,000, CGST ₹900, SGST ₹900 |
| S9 | Export under LUT to C5 | 1 × I1 @ ₹10,000 | IGST ₹0, LUT declaration on invoice, "EXPWOP" in GSTR-1 Table 6A; POS 96 |
| S10 | 40% slab to C4 | 10 × I7 @ ₹100 | Taxable ₹1,000; CGST 20% ₹200, SGST 20% ₹200 |
| S11 | Mixed-rate invoice | I1 + I2 + I4 on one invoice to C1 | HSN summary splits by rate; tax per rate correct |
| S12 | Invoice numbering | Consecutive, unique within FY, ≤ 16 characters (Rule 46(b)), allowed characters `-` and `/` only |
| S13 | Invoice contents (Rule 46) | Supplier name, address, GSTIN; recipient GSTIN; invoice no. & date; HSN; description; qty & unit (UQC); taxable value; rate & amount per tax head; POS with state name when inter-state; reverse-charge Y/N; signature line |
| S14 | Cancel an invoice | Cancelled, not deleted; number not reused; appears as cancelled in GSTR-1 Table 13 (documents issued); removed from tax liability |
| S15 | Edit a finalised invoice | Audit trail kept (Companies Act Rule 3(1) audit-trail requirement) |
| S16 | Date validation | Future-dated invoice warned; back-dated invoice into a locked/filed period blocked or warned |

## Phase 3 — Credit and debit notes (Sec 34)

| ID | Case | Expected |
|---|---|---|
| N1 | Credit note on S1: 1 almirah returned | Taxable ₹9,000, CGST ₹810, SGST ₹810, total ₹10,620. Linked to original invoice number and date |
| N2 | Debit note on S2: price revision ₹2,000 | IGST ₹360, total ₹2,360 |
| N3 | Credit note on B2C Large (S3) | Reported in CDNUR (unregistered, inter-state > ₹1 lakh) |
| N4 | Credit note exceeding the invoice | Blocked or warned |
| N5 | Time limit | Warn when a note is raised after 30 November following the FY of the invoice |

## Phase 4 — Inward supplies and ITC

| ID | Case | Expected |
|---|---|---|
| P1 | Intra purchase from S1 | 10 × I1 @ ₹7,000 = ₹70,000; ITC CGST ₹6,300 + SGST ₹6,300; stock +10 |
| P2 | Inter purchase from S2 | 50 × I2 @ ₹1,000 = ₹50,000; ITC IGST ₹2,500 |
| P3 | Reverse charge: legal fees from S3 | ₹10,000; RCM liability CGST ₹900 + SGST ₹900 in 3B 3.1(d); ITC in 3B 4A(3) same amount; self-invoice supported |
| P4 | Blocked credit 17(5) | Expense for staff food ₹5,000 + 5% GST: ITC not claimed (3B 4B(1) or not in 4A) |
| P5 | Purchase return / debit note to supplier | ITC reversed |
| P6 | GSTR-2B import / reconciliation | Matches, mismatches and missing bills flagged |
| P7 | Duplicate supplier bill number | Same supplier + same bill number warned |

## Phase 5 — Receipts, payments and TDS

| ID | Case | Expected |
|---|---|---|
| R1 | Full receipt for S1 by bank | Debtor C1 cleared; bank + ₹36,990 |
| R2 | Receipt for S2 net of TDS 194J 10% | C2 pays ₹21,600 and deducts ₹2,000 TDS (10% of taxable ₹20,000, not of GST). TDS receivable ₹2,000; debtor cleared |
| R3 | Partial receipt for S3 | ₹50,000; balance ₹79,800; ageing shows it |
| R4 | Advance from customer | Advance receipt voucher; liability until invoiced (GST on advances for services) |
| R5 | Payment to S1 | Creditor reduced |
| R6 | TDS on payment to advocate (194J) | 10% on ₹10,000 = ₹1,000 deducted; payable to govt |

## Phase 6 — Returns

Expected totals below cover only the `CA-` transactions. Existing QA data (INV-001 ₹2,610, CN-001 ₹354, draft proformas) is captured as a baseline first, then subtracted.

| ID | Report | Expected |
|---|---|---|
| G1 | GSTR-1 B2B (4A) | S1, S7, S11 to C1; S2 to C2; values as above |
| G2 | GSTR-1 B2CL (5) | S3 only, POS 24 |
| G3 | GSTR-1 B2CS (7) | S4, S5, S8, S10 grouped by POS + rate; S3 excluded |
| G4 | GSTR-1 Exports (6A) | S9, WOPAY |
| G5 | GSTR-1 Nil/exempt (8) | S6 ₹500 intra, to unregistered |
| G6 | GSTR-1 CDNR (9B) | N1, N2 |
| G7 | GSTR-1 CDNUR (9B) | N3 |
| G8 | GSTR-1 HSN summary (12) | Split B2B / B2C tabs (Phase-III format since 2025); UQC; tax by head |
| G9 | GSTR-1 documents issued (13) | Invoice series from/to, total, cancelled count |
| G10 | GSTR-1 JSON export | Downloads; valid structure (gstin, fp `092026`, sections) |
| G11 | GSTR-3B 3.1(a) | Outward taxable (excl. zero/nil) net of notes: taxable value and tax both net of credit notes |
| G12 | GSTR-3B 3.1(b) | Zero-rated: S9 ₹10,000, IGST 0 |
| G13 | GSTR-3B 3.1(c) | Nil/exempt: ₹500 |
| G14 | GSTR-3B 3.1(d) | RCM inward: ₹10,000, CGST ₹900, SGST ₹900 |
| G15 | GSTR-3B 3.2 | Inter-state to unregistered by POS: Gujarat ₹1,10,000 / IGST ₹19,800 |
| G16 | GSTR-3B 4A | ITC: IGST ₹2,500; CGST ₹6,300 + ₹900; SGST ₹6,300 + ₹900 |
| G17 | GSTR-3B 4B / 4D | Blocked credit P4 excluded |
| G18 | GSTR-3B net payable | Output − ITC per head, with cross-utilisation order (IGST first) |
| G19 | GSTR-9 | Annual figures agree with sum of monthly 1 and 3B |
| G20 | E-invoice / e-way bill | E-way bill number captured for goods > ₹50,000 (S3); e-invoice IRN/QR only if turnover > ₹5 cr (flag availability) |

## Phase 7 — Books of account

| ID | Case | Expected |
|---|---|---|
| A1 | Journal for S1 | Dr C1 ₹36,990 / Cr Sales ₹33,000 / Cr Output CGST ₹1,995 / Cr Output SGST ₹1,995 |
| A2 | Journal for P1 | Dr Purchases (or Stock) ₹70,000 / Dr Input CGST ₹6,300 / Dr Input SGST ₹6,300 / Cr S1 ₹82,600 |
| A3 | Trial balance | Debits = credits; tax ledgers match returns |
| A4 | Output and input tax ledgers | Balances equal GSTR-1 / 3B totals for the month |
| A5 | Party ledgers | C1: invoice, credit note, receipt; closing balance right |
| A6 | Profit and loss | Sales net of returns; purchases; expenses; gross and net profit add up |
| A7 | Balance sheet | Assets = liabilities + capital; debtors, creditors, GST payable/receivable, TDS receivable shown |
| A8 | Manual journal | Unbalanced journal rejected; balanced one posts to ledgers |
| A9 | Cash and bank book / day book | Receipts and payments listed chronologically |
| A10 | Stock valuation | Closing stock = opening + purchases − sales; valuation method stated |
| A11 | Receivables / payables ageing | Buckets correct |
| A12 | Bank reconciliation | Unreconciled entries listed; statement import works |
| A13 | Period lock | Locking a filed period prevents edits |
| A14 | Round off and discount ledgers | Posted to their own ledgers |

---

## Results

Filled in as each phase runs. Figures quoted are exactly what staging showed.

Run 1: 27 Sep 2026, staging build `bffff01`.

### Phase 1: Setup and masters

| # | Result | Seen | Expected / CA comment |
|---|--------|------|-----------------------|
| M1 | Partial | Business PAN blank although GSTIN `27AAQCT1234A1ZL` embeds PAN `AAQCT1234A` | PAN should be derived from GSTIN (needed for TDS/TCS and Form 26AS matching) |
| M2 | Fail | `27AAPFU0939F1ZX` (wrong check digit) shows "GSTIN format valid" and saves | Mod-36 checksum must be validated; state should auto-fill from the first two digits |
| M3 | Fail | Customer saved with GSTIN `29AABCT1332L1ZX` (Karnataka) and state Maharashtra 27. INV-012 to this customer charged CGST ₹37.50 + SGST ₹37.50 | GSTIN state code must drive place of supply for B2B; supply should be inter-state (IGST ₹75) |
| M4 | Fail | HSN lookup returns no suggestions; 4-digit "1234" accepted | Validate against the HSN master; 6 digits mandatory above ₹5 cr turnover, 4 below |
| M5 | Fail | Tax rate is a free number; item saved at 7% | Restrict to notified slabs 0 / 0.25 / 3 / 5 / 18 / 40 (plus cess) |
| M-UQC | Partial | Units PCS/KG/BOX/LTR/MTR/NOS/HRS/DAYS | GSTR-1 HSN summary needs UQC codes (KGS, LTR, NOS, BOX, MTR, OTH…); map units to UQC |
| M-VAL | Fail | Valuation method list offers LIFO | AS 2 / Ind AS 2 do not permit LIFO; remove it |
| M6–M8 | Not run | | Cess, FY settings, opening balances pending |

### Phase 4: Purchases and ITC

| # | Result | Seen | Expected / CA comment |
|---|--------|------|-----------------------|
| P1 | Pass | DSW/118: 20 × almirah @ ₹7,000 → taxable ₹1,40,000, CGST ₹12,600, SGST ₹12,600, total ₹1,65,200; stock 0 → 20 | Same |
| P1-bug | Fail | API response `credit_metrics.projected.current_balance` = `165200165200` | String concatenation instead of addition; projected supplier balance should be ₹3,30,400 or ₹1,65,200 depending on intent |
| P2 | Pass | KRM/7781: 50 × rice @ ₹1,000 from Karnataka → IGST ₹2,500, total ₹52,500, POS 27 | Same |
| P3 | Fail | RCM bill AM/2026/45 (advocate, ₹10,000 @ 18%): grand total and balance due ₹11,800 | Supplier is owed ₹10,000 only; ₹1,800 is our RCM liability. Ledger code posts AP ₹10,000 + RCM Output ₹1,800 correctly, so the bill record and books disagree by ₹1,800 and paying the "balance" overpays the advocate |
| P4 | Pass (entry) | Catering ₹5,000 + ₹900 GST, ITC Eligible unticked, total ₹5,900 | To confirm in GSTR-3B that ₹900 is not claimed (blocked by plan, see below) |
| P7 | Fail | Second bill DSW/118 from same supplier saved with no warning | Duplicate supplier invoice number in the same FY should be blocked or warned (double ITC risk). No duplicate check exists in `/api/purchases` |
| UX | Partial | Item picker dropdown opens outside the viewport in the purchase line table | Cosmetic, but blocks mouse selection on smaller screens |
| UX | Partial | Purchase line "Discount Account" dropdown lists sales accounts (4101 Sales…) | Purchase discounts should map to Discount Received / purchase accounts only |

### Phase 2: Sales

| # | Result | Seen | Expected / CA comment |
|---|--------|------|-----------------------|
| S1 | Pass | INV-004: taxable ₹33,000, CGST ₹1,995, SGST ₹1,995, total ₹36,990 | Same |
| S2 | Pass | INV-005: POS auto Karnataka, IGST ₹3,600, total ₹23,600 | Same |
| S3 | Pass | INV-006: POS Gujarat, IGST ₹19,800, total ₹1,29,800 | Same (B2CL > ₹1 lakh) |
| S4 | Pass | INV-007: CGST ₹37.50, SGST ₹37.50, total ₹1,575 | Same |
| S5 | Fail | INV-008: taxable ₹299.97, CGST ₹27.00, SGST ₹27.00, **total ₹353.96** | Total must equal ₹299.97 + ₹27.00 + ₹27.00 = ₹353.97. Server sums unrounded tax (₹353.9646) while storing rounded heads |
| S6 | Pass | INV-009: nil-rated ₹500, no tax | Same |
| S7 | Pass | INV-010: gold 3% → CGST ₹750, SGST ₹750, total ₹51,500 | Same |
| S8 | Partial | No "price includes GST" option on the sales invoice (only a per-item price flag); purchase form has one | Retailers need invoice-level inclusive pricing |
| S9 | **Fail (critical)** | INV-013 export WOP/LUT: screen shows IGST 0 and total ₹10,000; saved invoice has `export_type=wop`, `lut_declaration=true`, **IGST ₹1,800, total ₹11,800**. Re-tested on the new build (draft INV-018): same | Zero-rated under LUT must carry IGST 0. Server tax calc in `app/api/invoices/route.ts` ignores export type |
| S10 | Pass | INV-011: 40% slab → CGST ₹200, SGST ₹200, total ₹1,400 | Same |
| S11 | Pass | INV-014: 18% + 5% + 0% on one bill → CGST ₹975, SGST ₹975, total ₹16,950 | Same |
| S12 | Pass (going forward) | Series INV-004 → INV-018 consecutive. Earlier gap INV-001 → INV-004 caused by proformas sharing the old counter before migration 301 | Drafts also consume tax-invoice numbers (INV-015, INV-018); if a draft is deleted the series will have a gap, which must then be reported in Table 13 |
| S14 | Pass | INV-016 and INV-017 cancelled with mandatory reason; stock reversed (almirah 5 on hand = 20 − 15 net sold) | Dialog says "removed from GSTR-1": cancelled numbers must still appear as cancelled in Table 13 (to verify) |
| S15 | Pass | Finalised invoice has no Edit button, only Cancel | Correct practice; corrections via credit/debit note |
| S16 | Partial | Draft dated 15-Dec-2026 saved without a warning | Future-dated tax invoices should at least warn |

### Phase 3: Credit and debit notes

| # | Result | Seen | Expected / CA comment |
|---|--------|------|-----------------------|
| N1 | Fail + Blocked | Credit note for 1 of 2 almirahs from INV-004 (10% trade discount): form shows taxable **₹8,000**, CGST ₹720, total ₹9,440. Save returns 403 "Feature not available in your plan" | Taxable should be ₹9,000, CGST ₹810, SGST ₹810, total ₹10,620. The whole ₹2,000 line discount is applied to one unit instead of pro-rata. Credit notes are statutory (s.34) and are not in the Professional plan |
| N2 | Fail | Debit note DN on INV-005 (₹2,000 + IGST ₹360): 500 `column "discount_percent" of relation "debit_note_items" does not exist` | Table (migration 005) has `discount`; API inserts `discount_percent`/`discount_amount`. No debit note can be saved |
| N2-design | Fail | Code adds the debit note total to the original invoice's `grand_total` | The original invoice value must not change; the note is reported separately in GSTR-1 Table 9B. Otherwise the ₹2,360 is counted twice |
| N2-form | Partial | Debit note number must be typed by hand; no HSN field; linked-invoice list shows all customers' invoices | Auto-number the series; HSN is mandatory on notes (Rule 53); filter invoices by the chosen customer |
| N-link | Partial | Credit note "Link to Invoice" is optional | Original invoice number and date are mandatory for CDNR reporting |

### Blocked by plan

On the Professional plan these APIs return 403 `FEATURE_NOT_IN_PLAN`: GSTR-1 and GSTR-3B (`reports_gst`), trial balance, P&L, balance sheet, stock valuation and ageing (`reports_advanced`), and credit notes. Phases 5–7 need the test business on a plan that includes them.

---

Run 2: 27 Sep 2026, staging build `2c98854`, business moved to Enterprise.

### Retest of Run 1 fixes

| # | Result | Seen | Expected / CA comment |
|---|--------|------|-----------------------|
| S9 | Pass | INV-019 export WOP/LUT, ₹20,000 consultancy @ 18%: IGST ₹0, total ₹20,000 | Same |
| S5 | Pass | INV-020: 3 × ₹99.99 @ 18% → ₹299.97 + ₹27.00 + ₹27.00 = **₹353.97** | Same |
| N2 | Pass | DN-RT-001 on INV-020 (₹100 @ 18%): ₹100 + ₹9 + ₹9 = ₹118. INV-020 grand total stays ₹353.97, balance ₹353.97 → ₹471.97; customer ₹4,182.93 → ₹4,300.93 | Same |
| N1 | Pass | INV-021: 2 almirahs @ ₹10,000, 10% disc → ₹21,240. CN-002 for 1 unit (form): ₹9,000 + ₹810 + ₹810 = ₹10,620. Invoice balance → ₹10,620, customer −₹10,620, stock +1 | Same |
| P3 | Pass | ADV-RT-01 RCM ₹10,000 @ 18%: stored total ₹11,800, balance due ₹10,000, supplier +₹10,000 | Same. Run 1 bill AM/2026/45 still carries ₹11,800 (old data not migrated) |
| P7 | Pass | SEW/RT/501 saved; re-entry as `sew/rt/501 ` → 409 `DUPLICATE_SUPPLIER_BILL` | Same (case and spaces ignored) |

### New findings

| # | Result | Seen | Expected / CA comment |
|---|--------|------|-----------------------|
| N3 | **Fail (critical)** | API accepted CN-PROBE-OVER: 5 almirahs returned against INV-021 (2 sold, 1 already returned). Credit ₹53,100 incl. ₹8,100 output GST reversed; INV-021 balance **−₹42,480** yet status "unpaid"; stock +5 phantom units | Returned quantity per line must not exceed invoiced − already credited; credit total must not exceed invoice value (s.34). Output tax reduction beyond the original supply is a GST exposure |
| N4 | Fail | Credit note with header total ₹50,000 on a ₹10,620 line: 500 "Voucher is not balanced … Debit 1.00, Credit 50000.00" | Server must recompute totals from lines (as debit notes now do). It was stopped only by the ledger balance check, with a raw 500 |
| N5 | Fail | No cancel/delete endpoint for credit notes (`/api/credit-notes` has GET and POST only) | A wrong note must be cancellable (with reason, kept in Table 13) or reversible |

### Phase 5: Receipts, payments and TDS

| # | Result | Seen | Expected / CA comment |
|---|--------|------|-----------------------|
| R1 | Pass | INV-004 ₹36,990 received by bank → paid, balance ₹0; bank ledger +₹36,990 | Same |
| R-DN | **Fail** | INV-020 (₹353.97 + DN-RT-001 ₹118, balance ₹471.97): receipt of ₹353.97 → status **paid, balance ₹0** | Balance must stay ₹118. `/api/payments` recomputes balance as grand_total − paid, ignoring debit and credit notes. Invoice list and party ledger now disagree |
| R-RCM | **Fail** | ADV-RT-01 (RCM, due ₹10,000): payment ₹9,000 → balance **₹2,800**, partially paid | Balance ₹1,000 (the TDS). `/api/payments` uses grand_total incl. RCM tax; only `/api/purchases/[id]/payments` was fixed |
| R-OVER | Partial | INV-019 ₹20,000: receipt ₹25,000 accepted silently; invoice paid ₹25,000; customer balance −₹25,000 | Customer ledger treats excess as advance (fine), but invoice should cap at ₹20,000 and show ₹5,000 on account, or warn |
| R2 / R6 | **Fail (critical)** | 194J set up (10%, threshold ₹50,000). Deduction on ₹60,000 → 500 "Voucher is not balanced … Debit 0.00, Credit 6000.00". ₹10,000 → rejected "below threshold" | `/api/tds/deduct` posts only Cr TDS Payable, no debit to the supplier; no TDS can ever be saved. Threshold is annual aggregate per payee, not per payment. No link to bill, no TDS base excluding GST, no 206AA 20% no-PAN rate |
| R2 (customer side) | Fail | Receipt form/API has no TDS field | Customers deducting 194J/194C/194Q pay net; need TDS Receivable (Form 26AS) on receipts |

### Phase 6: GST returns (September 2026)

| # | Result | Seen | Expected / CA comment |
|---|--------|------|-----------------------|
| G-tot | Pass | GSTR-1 taxable ₹2,83,399.94, tax ₹36,848 = sum of 15 final invoices | Same |
| G1 | Pass | B2B: INV-001, 004, 005, 010, 012, 014, 021 with GSTIN, POS, rate splits | Same (INV-012 POS 27 is the M3 master bug) |
| G2 | Pass | B2CL: INV-006, POS 24, ₹1,10,000 | Same |
| G3 | Partial | B2CS: 5% ₹1,500, 18% ₹599.94, 40% ₹1,000 correct; **0% ₹500 row (INV-009) also here** | Nil-rated goes only to Table 8 |
| G5 | **Fail** | Table 8 nil ₹2,500 = INV-009 ₹500 + INV-014 nil line ₹2,000, both already in B2CS/B2B as 0% rows; one row `INTRAB2C` only | Double reported. Table 8 must split INTRB2B / INTRB2C / INTRAB2B / INTRAB2C (INV-014 is intra B2B) |
| G4 | Partial | Exports: INV-019 WOPAY IGST 0 ✓. INV-013 (Run 1 data) WOPAY with IGST ₹1,800 | Legacy invoice from the old bug; portal rejects WOPAY with tax — needs a credit note |
| G6/G7 | **Fail** | DN-RT-001 (Walk-in, intra, ₹118) exported in CDNUR as `typ: B2CL` | CDNUR B2CL is only for inter-state > ₹1 lakh; notes on B2CS supplies are netted in Table 7. Portal will reject |
| G8 | Fail | HSN summary one table; UQC `KG` | Since May 2025 Table 12 is split B2B / B2C; UQC must be `KGS` |
| G9 | **Fail** | Table 13: INV-001 → INV-021, total 15, **cancelled 0**; no CN/DN series rows | INV-016/017 were cancelled (and INV-002/003/015/018 unused) — total and cancelled counts wrong; credit and debit notes need their own rows |
| G10 | Partial | JSON has gstin, fp `092026`, sections; `idt` = `27/9/2026`; `hash: "hash_value"` placeholder | Portal date format is `27-09-2026` |
| G11 | **Fail** | 3.1(a) taxable ₹1,99,199.94 | Expected ₹1,96,699.94 (net of notes, excl. zero-rated and nil). Nil ₹2,500 counted in both 3.1(a) and 3.1(c) |
| G12 | **Fail (critical)** | 3.1(b) zero-rated ₹30,000 with **IGST ₹3,298.43, CGST ₹379.06, SGST ₹379.06** | Exports carry no CGST/SGST. Ledger tax is being pro-rated across 3.1 rows by taxable value instead of taken from invoices |
| G14 | **Fail (critical)** | 3.1(d) inward RCM ₹0 (summary shows "rcm_pooled_component ₹3,600") | ₹20,000, CGST ₹1,800, SGST ₹1,800 (AM/2026/45 + ADV-RT-01) |
| G15 | Fail | No Table 3.2 in output | Inter-state to unregistered by POS: Gujarat ₹1,10,000 / IGST ₹19,800 |
| G16 | **Fail** | 4A(5) other ITC: IGST ₹2,500, CGST ₹14,850, SGST ₹14,850; 4A(3) RCM ₹0 | 4A(5) CGST/SGST ₹12,960 each; RCM ITC ₹1,800 each in 4A(3). ₹90 per head unexplained |
| G17 | Pass | Catering DSW/CAT/9 (ITC ineligible) ₹450/₹450 not in ITC; ₹900 added to cost | Same (should also appear in 4D(1) as ineligible) |
| G18 | Pass | Set-off: IGST ITC → IGST first, then CGST → IGST ₹11,954, SGST → IGST ₹10,746 | Rule 88A order respected |
| G-rec | Fail | 3B shows ledger vs GSTR-1 mismatch ₹1,950 CGST and SGST | Traced to cancelled INV-016/017 still in the output tax ledger (see A-CANCEL) |

### Phase 7: Books of account (as on 30 Sep 2026)

| # | Result | Seen | Expected / CA comment |
|---|--------|------|-----------------------|
| A3 | **Fail** | Trial balance Dr ₹5,33,111.93 / Cr ₹5,33,111.94, `is_balanced: false`; balance sheet reports balanced | Books must tie to the paisa (likely INV-008 posted with unrounded tax before the fix). BS must not report balanced when TB does not |
| A-CANCEL | **Fail (critical)** | Sales ₹2,59,199.94 = net sales ₹2,29,199.94 + ₹30,000 of cancelled INV-016/017; output CGST/SGST include their ₹1,950 each; customer CA-Shreeji still owes for them | `/api/invoices/[id]/cancel` reverses stock only: no ledger reversal, no customer balance reversal. Cancelled invoices also vanish from list APIs (so Table 13 shows 0) |
| A6 | **Fail (critical)** | P&L: sales ₹2,59,199.94, purchases ₹25,900, gross profit ₹2,33,299.94 (90%); COGS block shows closing stock ₹2,99,300 and COGS total **−₹2,73,400** | Goods purchases post to Inventory (1104) but sales never post COGS, so goods sold have no cost. Profit is overstated by the cost of every item sold |
| A10 | **Fail** | Stock at cost (items) ₹2,99,300 vs Inventory ledger ₹1,94,000 | Opening stock entered on items (e.g. Gold Ring 4 × ₹45,000) is not posted to the ledger (no Opening Stock / capital entry) |
| A2 | Pass | AP ₹2,39,320 = all final bills (RCM at ₹10,000) − ₹9,000 paid; RCM Output ₹3,600 | Same |
| A5 | Pass | AR ₹2,25,237.96 = sum of customer balances | Same (but both include cancelled invoices) |
| A-BANK | Pass | Bank ₹52,990 = ₹36,990 + ₹25,000 − ₹9,000 | Same |
| A-CLASS | Partial | Advocate fees and catering post to 5101 Purchases | Should go to Legal & Professional / Staff Welfare expense heads |
| A8 | Pass | Unbalanced journal (Dr 500 / Cr 400) rejected; balanced ₹100 entry posted | Same |
| A13 | **Fail** | Creating a period lock on Enterprise → 403 "Feature not available in your plan" | Period lock is essential after GSTR filing; gating is wrong |
| S16b | Fail | INV-022 dated 15-Aug-2026 finalised on 27-Sep after INV-021 (27-Sep), no warning | Backdating into a month whose GSTR-1 is due breaks number/date order; journals need a backdate reason > 30 days but invoices do not |

### Fixes after Run 2 (local, awaiting deploy)

Migrations to run on staging: **304** (credit/debit note status), **305** (reverse the ledger of already-cancelled invoices INV-016/017), **306** (purchase `tds_deducted`, TDS ↔ bill link), **307** (recompute invoice balances net of notes and RCM bill balances).

| Finding | Fix | Retest |
|---------|-----|--------|
| A-CANCEL | Invoice cancel reverses the invoice voucher (mirror lines, same date), reduces the customer balance, zeroes the balance, blocks cancel while active notes exist (409 `INVOICE_HAS_NOTES`); `?status=cancelled` lists cancelled invoices | TB sales/output tax drop by ₹30,000 / ₹1,950 each after 305; cancel a fresh invoice |
| N3, N4 | Credit note totals recomputed on the server from lines; invoice must be final and same customer; qty per item ≤ invoiced − already credited; total ≤ invoice + DN − CN; round-off < ₹1; POS taken from invoice | Retry CN-PROBE-OVER payload → 400 `RETURN_EXCEEDS_INVOICED` |
| N5 | `PATCH /api/credit-notes/[id]/cancel` (reason, GST-filed and period-lock checks): stock out, ledger reversed, customer and invoice balance restored; Cancel button on the list | Cancel CN-PROBE-OVER; INV-021 balance back to ₹10,620 |
| R2 / R6 | TDS posts Dr AP / Cr TDS Payable; reduces supplier and bill balance (`tds_deducted`); threshold on FY aggregate per payee+section; TDS rounded to the rupee (s.288B); TDS cannot exceed the bill outstanding | 194J ₹60,000 on a bill → TDS ₹6,000, voucher balanced |
| R-DN, R-RCM, R-OVER | All three receipt/payment routes recompute balances from source (invoice + DN − CN − paid; RCM bills net of tax, less TDS); payments above the outstanding are rejected with `PAYMENT_EXCEEDS_BALANCE` (take the excess as an on-account receipt) | INV-020 stays ₹118 due; ADV-RT-01 ₹1,000 due |
| G3, G5 | 0% lines only in Table 8, split INTRB2B / INTRB2C / INTRAB2B / INTRAB2C; exports/SEZ never in Table 8; JSON uses `nil_amt/expt_amt/ngsup_amt` | |
| G6/G7 | CDNUR only for B2CL and export notes; notes on B2CS supplies netted into Table 7 (listed in `cdn_b2cs`); cancelled notes excluded | DN-RT-001 appears in B2CS 18% intra |
| G8 | HSN split `hsn_b2b` / `hsn_b2c`, UQC mapped (KG → KGS, services → NA) | |
| G9 | Table 13 counts cancelled invoices and adds credit-note and debit-note series, grouped by number prefix | INV series cancel = 2 |
| G10 | All GSTR-1 dates dd-mm-yyyy | |
| G4 | Export with IGST charged reported as WPAY regardless of the stale flag | |
| G11, G12, G15 | 3.1(a)/(b) tax heads summed from documents (no pro-rating); nil excluded from 3.1(a); 3.1(e) non-GST; Table 3.2 by POS | 3.1(b) CGST/SGST = 0 |
| G14, G16 | 3.1(d) and 4A(3) from reverse-charge bills; 4A(1) bill of entry, 4A(2) import of services; 4A(5) = ledger ITC − 4A(1..3) + blocked; blocked 17(5) reversed in 4B(1) (Circular 170/02/2022) | 3.1(d) ₹20,000 / ₹1,800 / ₹1,800 |

Not fixed yet (need a decision): COGS / periodic-inventory P&L (A6), opening stock not in ledger (A10), period-lock plan gating (A13), backdated invoice warning (S16b), TB ₹0.01 (A3), no PAN on suppliers so 206AA 20% cannot apply, no TDS field on customer receipts.

### Fixes round 3 (local, awaiting deploy)

Migrations to run on staging after 304–307: **308** (perpetual inventory, `items.opening_stock_rate`, back-post COGS for existing invoices and credit notes), **309** (post opening stock to the ledger), **310** (post paisa residuals to 5299 Round Off), **311** (supplier PAN, TDS on receipts, 206AA flags).

| Finding | Fix | Retest |
|---------|-----|--------|
| A6 | Perpetual inventory (default for all businesses): each sale posts Dr COGS 5104 / Cr Inventory 1104 at weighted-average cost inside the invoice voucher; credit notes post the reverse; cancel and edit reverse/repost it. Bundles costed through components, services carry no cost. P&L takes COGS from the 5104 ledger; BS takes stock from the 1104 ledger | Gross profit on Gold Ring sale = sale value − 4 × avg cost; P&L no longer shows negative COGS |
| A10 | Opening stock posted as Dr Inventory 1104 / Cr Opening Balance Adjustment 3100 dated the FY start, re-synced on item create, import and edit (rate frozen in `opening_stock_rate`) | Inventory ledger = stock at cost after 308/309 |
| A13 | Period lock allowed on every paid plan and active trial (free/connect denied); unlock fixed (NULL branch rows no longer defeat the upsert; overlap check only when locking) | Lock and unlock September on Enterprise |
| S16b | Finalising an invoice dated in an earlier month than today, or before an existing later invoice, needs a reason (422 `BACKDATE_REASON_REQUIRED`; the UI prompts and retries). Filed GSTR-1 months stay blocked | Save an invoice dated 15-Aug → prompt for reason |
| A3 | Vouchers off by ≤ ₹0.01 get a balancing line to 5299 Round Off | TB `is_balanced: true` |
| R-PAN | Supplier PAN field (auto from GSTIN chars 3–12). Without a PAN, TDS uses s.206AA: higher of section rate and 20% (5% for 194Q/194O); stored as `higher_rate_206aa` | 194C on a PAN-less supplier → 20% |
| R-TDSREC | Receipts accept TDS deducted by the customer: Dr Bank + Dr TDS Receivable 1116 / Cr Debtors (amount + TDS); invoice settled = paid + `tds_received` | ₹10,000 receipt with ₹200 194J TDS clears a ₹10,200 invoice |
| R-TDSUI | "Deduct TDS on this bill" in the purchase payment modal (section, base = taxable value, preview) | Pay a 194J bill with TDS from the UI |

Still open: estimate / sales-order / WhatsApp conversions create invoices without ledger posting; period lock not enforced on payments and journals; voucher trigger tolerance still ₹0.01; variants costed at item-level rate.

### Run 3 — retest after deploying 304–311 (27 Sep 2026)

| # | Result | Seen | CA comment |
|---|--------|------|------------|
| A3 | Pass | TB Dr = Cr ₹4,99,329.94, `is_balanced: true`; ₹0.01 in 5299 Round Off | |
| A-CANCEL | Pass | Sales ₹2,29,299.94 (cancelled INV-016/017 reversed) | |
| A6 | Pass | COGS ₹1,38,250 = 13 invoices ₹1,80,450 − 3 credit notes ₹42,200; INV-016/017 carry no cost; GP ₹65,149.94 = sales − COGS − purchases | |
| A6-live | Pass | New INV-023 posted Dr COGS / Cr Inventory ₹7,000 (Almirah avg cost); cancel reversed COGS and sales on the same date | |
| A10 | **Fail** | Migration 309 ran (opening_stock_rate set) but 3100 shows ₹0 and Inventory ₹55,750 | Opening stock lines post with no branch; TB / P&L / BS / account ledger drop NULL-branch lines whenever the user has branch assignments (customer/supplier opening balances are hidden the same way). Fixed locally, see below |
| A13 | Pass | Lock Aug-2026 → 201; duplicate → 400 overlap; Aug invoice → 403 `PERIOD_LOCKED`; unlock → 200 | |
| S16b | Pass | Aug-dated final invoice: no reason / 3-char reason → 422 `BACKDATE_REASON_REQUIRED`; proper reason → INV-023 saved | |
| N3/N4 | Pass | Return of 5 and of 1 on INV-021 → 400 `RETURN_EXCEEDS_INVOICED` (open qty 0 while CN-PROBE-OVER is active) | |
| N5 | **Fail** | Cancel CN-PROBE-OVER → 403 "i.trim is not a function" | GST-filed check called `.trim()` on the DATE column (a JS Date). Fixed locally |
| R-PAN | Pass | PAN backfilled from GSTIN (Deccan Steel ABCPD1234E); advocate without GSTIN has no PAN | |
| R-206AA | Pass | New bill AM/2026/52 ₹40,000 (FY aggregate ₹60,000 > ₹50,000): 194J TDS @ 20% = ₹8,000, `higher_rate_206aa`, Cr TDS Payable, bill balance ₹32,000 | Earlier bills (₹20,000) are not auto-caught-up once the threshold is crossed; deduct on them separately |
| R-TDSREC | Pass | INV-005 ₹23,600: ₹21,601 + ₹2,000 TDS → 400 `PAYMENT_EXCEEDS_BALANCE`; ₹21,600 + ₹2,000 → paid; Bank +₹21,600, TDS Receivable ₹2,000, AR −₹23,600, TB balanced | TDS on value excluding GST (Circular 23/2017) |
| G3–G10 | Pass | B2CS 18% ₹699.94 = INV-008 + INV-020 + DN-RT-001 (INV-022 of August excluded); nil split INTRAB2B ₹2,000 / INTRAB2C ₹500; exports WPA/WOPA; Table 13 INV 17 issued / 2 cancelled, CN and DN series separate; HSN B2B/B2C with UQC | |
| G-HSN | **Fail** | HSN Table 12 built from invoices only (Almirah B2B ₹28,000 gross) | Table 12 must be net of credit/debit notes. Fixed locally |
| G-CDNR | Minor | `idt` null on CDNR for notes without `original_invoice_date` | Falls back to linked invoice date. Fixed locally |
| G11–G16 | Pass | 3.1(a) ₹1,96,699.94 (IGST ₹23,400, C/S ₹946); 3.1(b) ₹30,000 / ₹1,800; 3.1(c) ₹2,500; 3.1(d) ₹60,000 / ₹5,400 each; 3.2 POS 24 ₹1,10,000; 4B ₹450 each; 3B = GSTR-1 by head; RCM payable in cash ₹10,800 | |

### Fixes after Run 3 (local, awaiting deploy; no migration)

- Consolidated TB, P&L, balance sheet and account ledger include business-level lines (`branch_id IS NULL`: opening stock, customer/supplier opening balances) when the user is restricted to branches.
- `assertGstPeriodNotFiledForDocumentDate` and period-lock checks accept DB `Date` values (local calendar date, not UTC).
- Invoice cancel is blocked for a filed GSTR-1 month (issue a credit note) and for a locked period.
- GSTR-1 HSN (all, B2B, B2C) netted with active credit notes (−) and debit notes (+) of the period.
- CDNR / CDNUR original invoice date falls back to the linked invoice.
- TDS threshold aggregate excludes draft bills.

Retest after deploy: TB shows 3100 Cr ₹2,43,500 and Inventory ₹2,99,250; cancel CN-PROBE-OVER (COGS back to ₹1,73,250, INV-021 balance restored); GSTR-1 HSN Almirah B2B net of CN-002.

### Run 4 — after deploying c580292 (27 Sep 2026, UI/API plus read-only DB checks)

| # | Result | Seen | CA comment |
|---|--------|------|------------|
| A10 | Pass | 3100 Cr ₹2,43,500; DB: 5 opening_stock vouchers dated 01-Apr-2026 | |
| N5 | Pass | CN-PROBE-OVER cancelled (second cancel 409); stock out 5; INV-021 balance ₹10,620; COGS ₹1,73,250; sales +₹45,000; AR +₹53,100; customer balance = open invoices ₹79,070; TB balanced | |
| G-CDNR | Pass | CN-001 / CN-002 carry original invoice date; Table 13 shows CN-PROBE-OVER as cancelled | |
| P-SAC | **Fail** | Inventory ₹3,39,250 = expected + ₹40,000: bill AM/2026/52 (SAC 998216 legal retainer) auto-created a *goods* item and posted Dr Inventory | A SAC code can never be stock. Only this QA bill is affected on staging (DB check) |
| P-DEL | **Fail** (code review) | Deleting a final bill leaves its TDS voucher and `tds_transactions`, and skips GST-filed / period-lock checks | |
| G-HSN2 | **Fail** | INV-021 line saved without HSN (API payload used `hsn_code`) so it is missing from Table 12; CN-002 then shows as a lone negative row | HSN is mandatory on tax invoices (Notification 78/2020) |

### Fixes after Run 4 (local, awaiting deploy; no migration)

- Purchase lines with a SAC (chapter 99) code, or `line_item_type: 'service'`, are services: no stock, no auto-created goods item (`app/api/purchases/route.ts`, `lib/purchases/purchase-create-service.ts`).
- Deleting a final bill: blocked for a filed GST month or locked period; blocked if its TDS is deposited; otherwise the TDS voucher and TDS record are removed with the bill.
- Invoice lines without HSN take the item's HSN on save; GSTR-1 falls back to the item's HSN for existing lines.
- HSN netting of a note merges into the invoice row with the same HSN and rate when units differ.

Staging data to correct after deploy: delete test bill AM/2026/52 (reverses stock, GL and the ₹8,000 TDS) and re-enter it as a service bill.
