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
