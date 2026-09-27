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
