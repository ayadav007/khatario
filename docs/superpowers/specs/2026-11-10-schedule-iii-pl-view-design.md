# Schedule III view of the Profit & Loss: design

Date: 2026-11-10. Status: written for owner review, nothing built.

## 1. What the owner asked

"Our profit and loss report is our own format and it does not follow schedule 3 format." Then: "make sure we are not changing anything in our current P&L report, we should have a separate tab for schedule 3 view."

## 2. Decision in one paragraph

Add a second tab, **Schedule III**, beside the existing report. It reads the same ledger lines and shows them in the Statement of Profit and Loss layout of Schedule III, Division I (Companies Act, 2013). The existing report, its API, PDF, Excel and drill-down stay byte-for-byte as they are. The new view is report-only: no posting, account code or voucher changes. Its "Profit for the period" must always equal the Standard tab's net profit, and the tab shows that check on screen.

## 3. The two layouts

| | Standard tab (today, unchanged) | Schedule III tab (new) |
|---|---|---|
| Expense grouping | By function: cost of goods sold, operating, non-operating | By nature: materials, purchases, stock change, staff, finance, depreciation, other |
| Sub-totals | Gross profit, operating profit, net profit, plus EBITDA / EBIT / PBT | Total income, total expenses, profit before tax, profit for the period |
| Columns | One period | Current period and the same dates one year earlier |
| Source of placement | `accounts.pl_section` | A Schedule III line per account (default by rule, owner can override) |

## 4. Statement rows

| # | Row | Filled from |
|---|---|---|
| I | Revenue from operations | Accounts on this line |
| II | Other income | Accounts on this line |
| III | Total income (I + II) | Computed |
| IV | Expenses | |
| | Cost of materials consumed | Computed from stock (section 6) |
| | Purchases of stock-in-trade | Computed from stock, plus accounts on this line |
| | Changes in inventories of finished goods, work-in-progress and stock-in-trade | Computed from stock |
| | Employee benefits expense | Accounts on this line |
| | Finance costs | Accounts on this line |
| | Depreciation and amortisation expense | Accounts on this line |
| | Other expenses | Accounts on this line |
| | Total expenses | Computed |
| | Inter-branch difference (not eliminated) | Shown only when it is not zero, consolidated view |
| V | Profit before exceptional and extraordinary items and tax (III − IV) | Computed |
| VI | Exceptional items | Accounts the owner moves to this line; nil by default |
| VII | Profit before extraordinary items and tax (V − VI) | Computed |
| VIII | Extraordinary items | Always nil |
| IX | Profit before tax (VII − VIII) | Computed |
| X | Tax expense: (1) Current tax, (2) Deferred tax | Accounts on these lines |
| XI | Profit for the period from continuing operations (IX − X) | Computed |
| XII–XIV | Discontinuing operations | Always nil |
| XV | Profit for the period (XI + XIV) | Computed; equals Standard net profit |

Earnings per share (XVI) is not shown; a footnote says share details are not kept.

## 5. Which line an account goes to

Order of rules, first match wins:

1. The line the owner chose for this account (`accounts.schedule3_line`), if it is a line an account may be put on.
2. The fixed line for a seeded account code (table below).
3. The line of the nearest parent account that matches rule 1 or 2.
4. A default from the account's Standard section: Operating Income → Revenue from operations; Non Operating Income → Other income; an income account sitting in Operating Expense → Other income; everything else → Other expenses. A user-created account in Cost of Goods Sold defaults to Other expenses (direct wages or power are not purchases).

| Code | Account | Line |
|---|---|---|
| 4101 | Sales | Revenue from operations |
| 4102, 4201, 4202, 4203, 4204, 4205 | Discount Received, Other Income, Interest, Dividend, Forex Gain, Profit on Sale of Fixed Assets | Other income |
| 5101, 5102, 5105 | Purchases, Purchase Returns, Freight Inward | Purchases of stock-in-trade |
| 5104 | Cost of Goods Sold | Stock cost, split by section 6 |
| 5209, 5212, 5214 | Provision for Employee Benefits, Salaries & Wages, Staff Welfare | Employee benefits expense |
| 5203, 5205 | Financial Expenses, Interest Expense | Finance costs |
| 5204 | Depreciation | Depreciation and amortisation |
| 5210 | Current Tax Expense | Current tax |
| 5211 | Deferred Tax Expense | Deferred tax |
| 5106, 5201, 5202, 5206, 5207, 5208, 5213, 5215, 5216, 5217, 5218, 5299 | Stock loss, admin, selling, forex loss, bad debts, warranty, rent, travel, legal, bank charges, loss on asset sale, round off | Other expenses |
| 4103, 5103 | Inter-branch sales and purchases | Eliminated in the consolidated view; Revenue and Purchases in a branch view |

Accounts 4103, 5101, 5102, 5103 and 5104 cannot be moved, because the stock figures depend on them. "Cost of materials consumed" and "Changes in inventories" cannot be chosen for an account; they are always computed.

## 6. Stock lines

The Standard report shows one cost figure. Schedule III wants purchases and the change in stock separately. Both add up to the same cost, so profit does not move.

**Perpetual books (the default).** A purchase debits a stock account (1104 trading, 1160 raw material, 1161 work in progress, 1162 finished goods) with voucher type `purchase`; a return credits it with `purchase_return`. A sale moves cost from stock to 5104. (Amended after the final review: a debit note here is a customer document and posts nothing to stock, so it is not a purchase type.)

- P(code) = net debit to that stock account in the period from `purchase` and `purchase_return` vouchers. In a single-branch view it also counts `inter_branch_receipt` vouchers, because goods received from another branch are that branch's purchases; the consolidated view leaves them out.
- M(code) = total debit − credit on that stock account in the period, leaving out `opening_stock` and `opening_balance` vouchers. Opening stock is posted inside the year, and counting it as a movement would understate materials consumed by the opening stock.
- C = movement on 5104 and its sub-accounts.
- Cost of materials consumed = P(1160) − M(1160).
- Purchases of stock-in-trade = P(1104) + P(1161) + P(1162), plus accounts on that line.
- Changes in inventories = C − Cost of materials consumed − P(1104) − P(1161) − P(1162).

Changes in inventories is the balancing figure on purpose. Stock write-offs (5106), landed-cost adjustments and inter-branch receipts move stock without passing through 5104; taking the change straight from stock balances would count a write-off twice.

**Periodic books.** As in the Standard report, the ledger rows 5101 and 5102 are replaced by the stock schedule.

- The Standard report rounds opening + purchases − closing once. The three rows here are rounded one by one, so the closing stock row is the balancing figure: closing row = rounded cost − rounded purchases − rounded opening. The three rows then add up to the Standard cost exactly, even when the stock values have more than two decimals.
- Purchases of stock-in-trade = purchases net of returns from the schedule, plus other accounts on that line.
- Changes in inventories = opening stock − closing stock, plus any balance on 5104.
- Cost of materials consumed = nil. Splitting raw material purchases on periodic books is out of scope.

## 7. Guarantees

- For any accounts, any stock figures, both inventory models, and both consolidated and branch views: Profit for the period = Standard net profit. A unit test asserts this over every seeded account code, and the API returns the difference so the screen can show "Agrees with the Standard Profit & Loss."
- No file of the Standard report is edited (list in the plan's Global Constraints).
- Same access rules as the Standard report: reports module, `report.financial` read, advanced reports plan feature, branch access.

## 8. Not in this piece of work

- PDF and Excel export of the Schedule III layout, and note numbers.
- Sale of products and sale of services as separate rows (one Sales account today).
- Employer PF/ESI as its own row, auditor payments, items above 1% of revenue.
- Earnings per share, discontinuing operations.
- Division II (Ind AS) and the ICAI format for non-corporate entities.
- The Flutter phone app.
- Showing the tab only to companies: there is no field for the kind of entity, so every business sees it.

## 9. Choices the owner may want to change

- Bank charges (5217) default to Other expenses. Some CAs show them under Finance costs; the owner can move the account.
- Freight inward (5105) is shown inside Purchases of stock-in-trade.
- Discount received (4102) is shown as Other income.
