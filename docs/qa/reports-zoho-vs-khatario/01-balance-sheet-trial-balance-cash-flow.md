# Balance Sheet, Trial Balance, Cash Flow: Zoho Books vs Khatario

Run: 01-Oct-2026. Test date: 28-Sep-2026.
Zoho: Tandoor Studio (org 910361617). Khatario: local, business "QA Reports Mirror" (created for these comparisons).

## Method

Posted the same 18 journals in both systems on 28-Sep (reference `QA-BS-E01` … `QA-BS-E18`), one per business event, each with a unique amount:

| # | Event | Amount | Zoho account | Khatario account |
|---|---|---:|---|---|
| E01 | Capital introduced | 500,001 | QA-BS Bank / Owner's Equity | 1102 / 3001 |
| E02 | Term loan received | 200,002 | QA-BS Term Loan (long-term liability) | 2201 Secured Loans |
| E03 | Furniture bought | 120,003 | QA-BS Furniture (fixed asset) | 1201 Fixed Assets |
| E04 | Depreciation | 12,004 | QA-BS Accum Depreciation (fixed asset) | 1202 Accumulated Depreciation |
| E05 | Credit sale 50,005 + GST 9,000 | 59,005 | Accounts Receivable / Sales / Output CGST, SGST | 1103 / 4101 / 2150, 2151 |
| E06 | Credit purchase 30,006 + GST 5,400 | 35,406 | Cost of Goods Sold / Input CGST, SGST / Accounts Payable | 5104 / 1110, 1111 / 2101 |
| E07 | Receipt from customer | 40,007 | Accounts Receivable | 1103 |
| E08 | Payment to supplier | 20,008 | Accounts Payable | 2101 |
| E09 | Prepaid expense | 6,009 | Prepaid Expenses | 1105 |
| E10 | Rent outstanding | 8,010 | QA-BS Outstanding Rent | 2104 |
| E11 | Drawings in cash | 7,011 | Drawings / Petty Cash | 3003 / 1101 |
| E12 | Customer advance | 11,012 | QA-BS Customer Advance | 2106 |
| E13 | Long-term investment | 25,013 | QA-BS Long-term Investment (other asset) | 1301 (Investments group) |
| E14 | Expense on credit card | 3,014 | QA-BS Credit Card | 2112 Bank OD / Cash Credit |
| E15 | Income-tax provision | 4,015 | QA-BS Income Tax Payable | 2109 Current Tax Payable |
| E16 | Warranty provision | 5,016 | QA-BS Provision Warranty | 2108 Provisions |
| E17 | Deposit (other asset) | 9,017 | QA-BS Other Asset (other asset) | 1901, directly under the top "Assets" group |
| E18 | Other liability | 2,018 | QA-BS Other Liability (other liability) | 2901, directly under the top "Liabilities" group |

Zoho had no other activity between 26 and 29 September, so Zoho's figures below are the 28-Sep balance minus the 27-Sep balance. The Khatario business is new, so its balances are the day's movement.

## Trial balance

Every account agrees: 29 accounts, debits = credits = 8,26,506 in Khatario, and the same per-account balances in Zoho. No calculation issues.

Presentation fixed: the Khatario page listed every account (including ~60 zero-balance ones) in one flat table. It now groups accounts by type (Assets, Liabilities, Equity, Income, Expenses) with a subtotal for each, like Zoho, and hides zero balances unless "Show zero balances" is ticked.

## Balance sheet

| Section | Zoho | Khatario before | Khatario after |
|---|---:|---:|---:|
| Current assets | 596,386 | 596,386 | 596,386 |
| Fixed assets | 107,999 | **0** | 107,999 |
| Investments + other assets | 34,030 | **25,013** | 25,013 + 9,017 |
| **Total assets** | **738,415** | **621,399** | **738,415** |
| Current liabilities | 55,465 | **46,434** | 55,465 |
| Long-term liabilities | 200,002 | 200,002 | 200,002 |
| Other liabilities | 2,018 | **0** | 2,018 |
| Equity (capital − drawings) | 492,990 | 492,990 | 492,990 |
| Current year earnings | see note | −12,060 | −12,060 |
| **Total liabilities & equity** | | **727,366 (not balanced)** | **738,415 (balanced)** |

Zoho note: Zoho's "Current Year Earnings" line still showed −42,954.42 on 28-Sep after the posting (unchanged from 27-Sep), and Zoho's own sheet total was off by the same 12,060. It looks like a cached figure in Zoho; the Zoho P&L for the day shows −12,060.

### Findings and fixes (`app/api/reports/balance-sheet/route.ts`, now built by `lib/reports/balance-sheet.ts`)

1. **Fixed assets came from the asset register, not the ledger (critical).** Postings to 1201/1202 without a register entry were ignored, so the sheet did not balance (−107,999 here). The register's book value was also today's value, not the value on the report date. Fixed: fixed assets are the ledger balances of the Fixed Assets group; the register net block is shown underneath for reference, with a warning if it differs.
2. **Provisions and tax accounts were dropped (critical).** 2108 Provisions, 2109 Current Tax Payable and 2110 Deferred Tax were removed from current liabilities and replaced by register figures, which only appeared when a financial year was typed in (and the provisions register always used today's date). Fixed: they are ledger accounts like any other.
3. **Accounts outside the standard sub-groups vanished (high).** An account directly under the top Assets or Liabilities group, or in a custom group, appeared nowhere. Inter-branch accounts (elimination group) were also dropped, which unbalances a branch view. Fixed: each account's group chain is walked to the top. Standard sub-groups map to Current / Fixed / Investments / Current / Long-term; anything else goes to the new **Other Assets** / **Other Liabilities** sections (Zoho has the same two sections). Inter-branch balances count as current.
4. **The screen hid negative balances but still counted them (medium).** Overdrawn cash (−7,011) and accumulated depreciation were not shown, so the visible lines did not add up to the totals. Fixed: negative balances are shown in red brackets, and unusual balances are listed in a warning box.
5. **Current-year profit ignored the branch and the financial year (medium).** It summed every income and expense line ever posted, for all branches, and labelled the result "current year". Fixed: current-year earnings come from the P&L engine for the financial year to date and the same branch scope, so the Balance Sheet always agrees with the P&L. Unclosed profit from earlier years is shown on its own line ("Profit of earlier years (not yet closed)"). A year-close voucher inside the current year is excluded so profit is not counted twice.
6. **Periodic inventory could unbalance the sheet (medium).** When a financial year was given, inventory was replaced by the closing-stock valuation, but profit stayed on ledger figures. Fixed: the P&L engine's closing-stock adjustment is added to both inventory and current-year earnings.
7. **The screen and its PDF showed different branches (medium).** The page fetched the consolidated sheet, while the PDF route always forced the default branch. Fixed: both now follow the branch selected in the app (no branch means consolidated).

## Cash flow

| Section | Zoho | Khatario before | Khatario after |
|---|---:|---:|---:|
| Operating | 15,016 | −10,024 | 24,006 |
| Investing | −142,029 | −120,003 | −154,033 |
| Financing | 692,992 | 692,992 | 692,992 |
| Net change in cash | 565,979 | 562,965 | 562,965 |

### Findings (`lib/reports/cash-flow.ts`)

1. **Investments and other non-current assets were treated as working capital (high).** 1301 and 1901 (34,030) appeared under operating activities as "Other current assets". Fixed: investments go to investing as "Investments (net)", and other non-current assets as "Other non-current assets", using the same group classification as the Balance Sheet.
2. **Credit card / bank overdraft (informational).** Khatario counts 2112 Bank OD / Cash Credit as part of cash (AS 3 allows bank overdrafts repayable on demand as cash equivalents), so the 3,014 lowers closing cash instead of appearing as an operating inflow. Zoho treats a credit card as an operating liability. Kept as is.
3. **Depreciation (informational).** Khatario adds depreciation back under operating activities (AS 3 indirect method). Zoho shows the accumulated-depreciation movement (+12,004) under investing. Net cash is the same; Khatario's layout is the standard one.

The remaining differences are fully explained by points 2 and 3: operating 24,006 = 15,016 + 12,004 − 3,014; investing −154,033 = −142,029 − 12,004.

## Tests

- `tests/lib/reports/balance-sheet.test.ts`: group classification, the 28-Sep scenario (every section and total), earlier-year profit, periodic inventory adjustment.
- `tests/lib/reports/cash-flow.test.ts`: investments and other non-current assets go to investing.
- `tests/db/pl-tb-bs-agreement.db.test.ts`: real database. An earlier-year posting shows as earlier-year profit, the sheet balances, and current-year earnings equal the P&L net.

## Test data left in place

- Zoho: journals 2–19 (`QA-BS-E01` … `QA-BS-E18`, 28-Sep-2026) and 12 accounts named `QA-BS …`.
- Khatario local: business "QA Reports Mirror" (phone 7700202610), the same 18 journals and accounts 1301, 1901, 2901.
