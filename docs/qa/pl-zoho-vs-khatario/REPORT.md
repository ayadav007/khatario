# Profit & Loss: Zoho Books (Tandoor Studio) vs Khatario (Shalini Traders, staging)

Run: 01-Oct-2026. Test date: 30-Sep-2026 (single-day P&L in both systems).

## Method

1. Created test accounts.
   - Zoho: QA-PL Income (income), QA-PL Other Income (other_income), QA-PL COGS (cost_of_goods_sold), QA-PL Expense (expense) and its child QA-PL Expense Child, QA-PL Other Expense, QA-PL Income Tax and QA-PL Loss on Asset Sale (other_expense), and QA-PL Inactive Expense (expense, deactivated after posting).
   - Khatario: 4901 in the Income group, 4902 in Other Income, 4903 in Sales, 5901 in Direct Expenses, 5902 in Indirect Expenses, 5903 in the top-level Expenses group, 5904 as a child of 5903, and 5905 (inactive after posting).
2. Posted one manual journal in each system, reference QA-PL-0930.
   - Every P&L account got a unique amount, so each one can be traced. Income lines were credited, expense lines debited, and the difference was balanced to equity (Zoho: Owner's Equity; Khatario: 3001 Capital).
   - Zoho: journal #1, id 8035881000000129071.
   - Khatario: JRN/2026/000001, voucher 18440ed1-9f04-4773-910b-f6fc653b915f.
3. Read each P&L through its own API, then the Khatario trial balance and balance sheet for the same date.
   - Zoho already had ₹10,000 on "Abhishek Other income" on 30-Sep. That amount is subtracted from the Zoho figures below.

## Where each account lands

| # | Line | Amount | Zoho account → section | Khatario account → section |
|---|---|---:|---|---|
| R1 | Sales | 10,001 Cr | Sales → Operating Income | 4101 → Income › Sales |
| R2 | Custom revenue | 10,002 Cr | QA-PL Income → Operating Income | 4903 (Sales group) → Income › Sales |
| R3 | General income | 1,003 Cr | General Income → Operating Income | 4201 → **Other Income (above gross profit)** |
| R4 | Interest income | 1,004 Cr | Interest Income → Operating Income | 4202 → Other Income (above gross profit) |
| R5 | Late fee / custom income | 1,005 Cr | Late Fee Income → Operating Income | 4901 (Income group) → Other Income (above gross profit) |
| R6 | Shipping charge | 1,006 Cr | Shipping Charge → Operating Income | no equivalent account |
| R7 | Discount allowed | 1,007 Dr | Discount → Operating Income (negative) | no equivalent account |
| R8 | Rounding | 1,008 Cr | Other Charges → Operating Income | 5299 Round Off → Indirect Expenses (negative) |
| R9 | Non-operating income, custom | 1,009 Cr | QA-PL Other Income → **Non Operating Income** | 4902 (Other Income group) → **Other Income, above gross profit** |
| R10 | Profit on sale of asset | 1,010 Cr | other_income → Non Operating Income | 4205 → Other Income, above gross profit |
| R11 | Dividend | 1,011 Cr | — | 4203 → Other Income, above gross profit |
| R12 | Discount received | 1,012 Cr | Purchase Discounts → **Operating Expense (negative)** | 4102 → **Other Income, above gross profit** |
| R13 | Foreign exchange gain | 1,013 Cr | — (Zoho uses one Exchange Gain or Loss account, non-operating) | 4204 → Other Income, above gross profit |
| C1 | Cost of goods sold | 2,001 Dr | Cost of Goods Sold → COGS | 5104 → Direct |
| C2 | Custom direct cost | 2,002 Dr | QA-PL COGS → COGS | 5901 → Direct |
| C3 | Purchases / materials | 2,003 Dr | Materials → COGS | 5101 → Direct |
| C4 | Purchase returns | 2,004 Cr | Job Costing → COGS (negative) | 5102 → Direct (negative) |
| C5 | Freight / labour | 2,005 Dr | Labor → COGS | 5105 → Direct |
| C6 | Stock loss / subcontractor | 2,006 Dr | Subcontractor → COGS | 5106 → Direct |
| E1 | Salaries | 3,001 Dr | Operating Expense | 5212 → **Direct (wrong)** |
| E2 | Rent | 3,002 Dr | Operating Expense | 5213 → **Direct (wrong)** |
| E3 | Staff welfare | 3,003 Dr | Operating Expense | 5214 → **Direct (wrong)** |
| E4 | Travel | 3,004 Dr | Operating Expense | 5215 → **Direct (wrong)** |
| E5 | Legal & professional | 3,005 Dr | Operating Expense | 5216 → **Direct (wrong)** |
| E6 | Bank charges | 3,006 Dr | Operating Expense | 5217 → **Direct (wrong)** |
| E7 | Admin / office | 3,007 Dr | Office Supplies → Operating Expense | 5201 → Indirect |
| E8 | Selling / advertising | 3,008 Dr | Operating Expense | 5202 → Indirect |
| E9 | Financial / card charges | 3,009 Dr | Operating Expense | 5203 → Indirect |
| E10 | Depreciation | 3,010 Dr | Depreciation Expense → Operating Expense | 5204 → **not shown anywhere** |
| E11 | Bad debts | 3,011 Dr | Bad Debt → Operating Expense | 5207 → Other Expenses (below operating profit) |
| E12 | Custom indirect expense | 3,012 Dr | QA-PL Expense → Operating Expense | 5902 (Indirect Expenses group) → **Direct (wrong)** |
| E13 | Custom child expense | 3,013 Dr | Operating Expense, nested under QA-PL Expense with a sub-total | 5904 → Indirect, flat list (no parent/child) |
| E14 | Custom expense, top group | 3,014 Dr | Other Expenses → Operating Expense | 5903 → Indirect |
| E15 | Expense on an inactive account | 3,015 Dr | Operating Expense (still shown) | 5905 → **not shown; also missing from trial balance** |
| E16 | Uncategorized | 3,016 Dr | Operating Expense | no equivalent account |
| N1 | Interest / finance cost | 4,001 Dr | other_expense → Non Operating Expense | 5205 → Other Expenses |
| N2 | Foreign exchange loss | 4,002 Dr | Exchange Gain or Loss → Non Operating Expense | 5206 → Other Expenses |
| N3 | Loss on sale of asset | 4,003 Dr | other_expense → Non Operating Expense | 5218 → **Direct (wrong)** |
| N4/N5 | Provisions (warranty, employee benefits) | 4,004 / 4,005 Dr | — | 5208 / 5209 → Other Expenses |
| N6 | Current tax | 4,006 Dr | other_expense → Non Operating Expense | 5210 → Tax (below profit before tax) |
| N7 | Deferred tax | 4,007 Dr | — | 5211 → Tax |
| X1/X2 | Inter-branch sales / purchases | 5,001 Cr / 5,002 Dr | — | 4103 → Other Income; 5103 → Indirect (consolidated view, not eliminated) |

## Totals for the test day

| | Zoho | Khatario (P&L) | Khatario if every line counted once |
|---|---:|---:|---:|
| Operating / total income | 24,022 | 33,071 (includes other income and inter-branch) | |
| Cost of goods sold / direct | 8,013 | 33,049 | |
| Gross profit | 16,009 | 22 | |
| Operating expense / indirect | 47,124 | 19,045 | |
| Operating profit | −31,115 | −19,023 | |
| Non-operating income | 2,019 | (inside income above) | |
| Non-operating / other expenses | 16,012 | 19,023 | |
| Tax | (inside non-operating) | 8,013 | |
| **Net profit** | **−45,108** (exactly the posted net) | **−46,059** | **−52,084** |

Khatario's −6,025 gap is depreciation 5204 (3,010) plus inactive 5905 (3,015).

The Khatario balance sheet's current-year profit moved by −52,084, the correct amount. So the P&L and the balance sheet now disagree by 6,025.

The Khatario trial balance for 30-Sep shows debits 133,091.23 and credits 136,106.23 (`is_balanced: false`). The 3,015 difference is the inactive account.

## Findings (in `app/api/reports/profit-loss/route.ts` unless noted)

1. **Indirect expenses are classified as direct (critical).** Line 405, `account_group_name?.toLowerCase().includes('direct')`, also matches "Indirect Expenses". Every account in group 5200 is pushed into cost of revenue: 5212–5218 and any custom indirect account. On the test day gross profit was understated by 25,036. The cause is the text match on the group name.
2. **Depreciation posted to 5204 disappears (critical).** 5204 is excluded from the indirect bucket (line 409). The separate depreciation line comes only from the fixed-asset calculator, and only when `financial_year` is passed. The P&L page never passes it, and even with `financial_year=2026-27` it returned 0. Net profit is overstated and no longer agrees with the balance sheet.
3. **Inactive accounts are dropped (critical).** The P&L queries use `a.is_active = true` (lines 210, 227), so postings on a deactivated account vanish from the P&L. The trial balance drops them too, and stops balancing. Zoho keeps reporting inactive accounts.
4. **No non-operating income section (high).** All income sits above gross profit: interest, dividend, foreign exchange gain, profit on asset sale, discount received, and accounts in the Other Income group. Zoho uses the account type to put Other Income below operating profit. On the test day Khatario's gross profit included 13,068 of such income.
5. **Screen doesn't add up (high).** `app/(app)/reports/profit-loss/page.tsx` lines 524–575: when COGS data exists, the page shows an Opening Stock + Purchases − Closing Stock block and hides the direct-expense accounts. Gross profit, however, subtracts the direct-expense total. Example on screen for 1-Apr to 1-Oct: income 44,963.75, COGS 14,169.35, gross profit −12,532.04. The missing ~43,326 is only explained inside a drill-down note. Shalini Traders uses perpetual inventory (each sale posts its cost to 5104), so the Opening + Purchases − Closing schedule doesn't apply to it anyway.
6. **Sections are chosen by hard-coded account codes (medium).** Other Expenses is only 5205–5209 and Tax only 5210/5211. A custom finance-cost or provision account can never reach those sections. Zoho lets the user pick the type (other_expense) for any account.
7. **Some system accounts sit in a different section from Zoho's equivalent (medium).**
   - 5207 Bad Debts: Khatario puts it below operating profit; Zoho counts it as an operating expense.
   - 5218 Loss on Sale of Fixed Assets: Khatario counts it as direct, because of finding 1; Zoho treats it as non-operating.
   - 4102 Discount Received: Khatario counts it as income above gross profit; Zoho books it as a contra operating expense.
   - 5299 Round Off: Khatario shows it as a negative indirect expense; Zoho books rounding to Other Charges income.
8. **Inter-branch accounts aren't eliminated in the consolidated view (medium).** 4103 is shown as Other Income and 5103 as Indirect. Net profit is unaffected when both sides exist, but gross profit and indirect expenses are inflated.
9. **No sub-account nesting (low).** A child account is listed flat. Zoho nests it under its parent with a sub-total.
10. **Things Khatario has that Zoho lacks (informational).** A separate Tax section (5210/5211) below profit before tax, and provision lines. Zoho has no tax section; income-tax accounts go to Non Operating Expense.

## Account-type model

- Zoho: the section comes from the account type (income, other_income, cost_of_goods_sold, expense, other_expense). The user chooses it when creating the account.
- Khatario: `account_type` is only income or expense. The section is then guessed from the group name ("sales", "direct") and from hard-coded codes. Custom groups behave unpredictably: any group whose name contains "sales" counts as Sales, and any group whose name contains "direct" counts as Direct.

## Test data left in place

- Zoho journal QA-PL-0930 (30-Sep-2026) and 9 QA-PL accounts, one of them inactive.
- Khatario JRN/2026/000001 and accounts 4901, 4902, 4903, 5901, 5902, 5903, 5904 and 5905 (inactive).
- Both journals are labelled "QA P&L account-mapping test".
