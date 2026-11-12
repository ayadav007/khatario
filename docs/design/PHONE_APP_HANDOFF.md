# Phone app — handoff for the design work

Written 13 Oct 2026 by the agent porting the website into the Flutter app in `phone/`. Read this before changing how the phone app looks, so the redesign and the port don't overwrite each other.

## What is built

Every screen below calls the live staging APIs and was copied from the mobile website (`https://staging.khatario.com`) pixel for pixel. The user has approved each one.

| Area | Files |
|---|---|
| Login | `lib/screens/login_screen.dart` |
| Shell: header, bottom nav, business switch, banners | `lib/shell/app_shell.dart`, `lib/shell/shell_banners.dart`, `lib/shell/dashboard_overlays.dart`, `lib/shell/date_range.dart` |
| Home dashboard and Customize | `lib/screens/dashboard_screen.dart`, `dashboard_widgets.dart`, `dashboard_charts.dart`, `lib/shell/module_settings_sheet.dart` |
| Invoices: list, detail, PDF, share, record payment | `lib/screens/invoices/` |
| Items: list, filters, CSV import, detail, adjust stock | `lib/screens/items/` |
| More menu and account card | `lib/screens/more/` |

## Logic and styling are separate

These hold rules copied from the website and don't depend on the look. A redesign should keep them as they are:

- `lib/capability.dart`: permission and plan checks (which rows are shown or locked).
- `lib/screens/more/more_navigation.dart`: which More menu sections and rows exist, and in what order.
- `lib/api.dart`, `lib/session.dart`: API calls and sign-in. `business_id` and the acting user always come from the server session.
- `lib/format.dart`: rupee and date formatting.
- `lib/screens/items/item_csv.dart`: CSV import parsing.
- In `app_shell.dart`: Back from a screen opened from More returns to More; the capability and usage loading.

Tax, stock and ledger maths stay on the server. The phone never computes GST or stock itself.

## Where the look lives

- `lib/theme.dart`:
  - `KhatarioColors`: brand colours.
  - `PortalTheme`: the user's theme and font presets (`inter`, `system`, `dm_sans`, `source_sans`), set from the website's Customize.
  - `Tw`: Tailwind colour values used to match the website.
- `lib/ui/web_ui.dart`: shared widgets copied from the website (`WebCard`, `WebInput`, `WebButton`, `WebAlert`, `WebSelect`, `WebStatusBadge`, …).
- Many screens still set sizes, paddings and `Tw.*` colours inline, because they were copied one to one. **If the redesign brings in design tokens (colours, type scale, spacing, radius), please define them in `theme.dart` and tell us**. We will then move the screens onto those tokens instead of rebuilding them.

## Tests that will change

`phone/test/goldens/*.png` (38 images) are screenshots of the current look. A redesign will change them. Regenerate them on purpose with `flutter test --update-goldens`. The behaviour checks in the same tests (labels, locks, navigation, API calls) should still pass after a visual change.

## Paused until the design is agreed

- Showing app toasts at the top like the website (planned `lib/ui/toast.dart`, replacing SnackBars).
- Any further pixel-matching of new screens.

## Questions for the design work

1. Is `docs/design/phone-prototype/dashboard-india.html` the direction for the whole phone app, or only the dashboard?
2. Should the phone keep the user's portal theme and font choice from the website, or use one fixed design?
3. Will the website get the same redesign? (The phone has been copying the website.)
4. Which screens come first, and when will the colour and type values be final?

## Design system (agreed 13 Oct 2026)

Answers to the questions above:

1. **Direction:** a fresh look, not `dashboard-india.html`. The mockup is `docs/design/phone-prototype/fresh-direction.html`. It uses a light cream background with no colour band, borderless soft cards, large amounts in tabular figures, and one action colour.
2. **Theme:** the phone keeps the business portal theme for the **brand colour only** (`AppColors.brand`, `brandSoft`, `brandStrong`, with `onBrand` picked by contrast). Neutrals and money colours (positive, due, negative) are fixed. The font preset still applies.
3. The phone no longer copies the website pixel for pixel. Logic, API calls and labels still follow the website.
4. **Order:** foundation, shell, Home, Invoices list and Invoice detail are done. Next: Items list, Parties, More, forms (new invoice, item, customer), payment in, search and notifications.

### Where things live

- `lib/theme.dart`: `AppColors`, `AppSpace` (4px grid, 16px gutter), `AppRadius` (10, 14, 16, 24 for sheets), `AppShadow`, `AppText` (display 40, title 26, amount 24, heading 17, body 15, label and caption 13, small 12, overline 12).
- `lib/ui/kit.dart`: `KCard`, `KDivided`, `KAmount`, `KSectionHeader`, `KPageTitle`, `KChipBar`, `KSegmented`, `KSearchField`, `KIconButton`, `KAvatar`, `KListRow`, `KStatusDot` and `statusTone()`, `KPill`, `KButton`, `KIconTile`, `KFab`, `KBottomBar`, `KEmptyState`, `KSpinner`, `showKSheet`, `KSheetAction`, `showKPicker`.
- `lib/ui/web_ui.dart` widgets now draw with the tokens. `pickWebSelectOption` opens a bottom sheet. Unported screens get the new look this way, but new work should use `kit.dart`.

### Rules

- Each screen has one primary action: a floating button on list tabs, or a `KBottomBar` on detail screens.
- The app bar shows the business (tap to switch), search, notifications and the tab's settings. Page titles go in the content (`KPageTitle`).
- Row actions (share, record payment) open from a long press on the row as a sheet, not as small icons.
- Status is shown as a dot and a word in lists, and as a `KPill` in headers.
- Use no `Tw.*` or hex colours in redesigned screens.

### Behaviour changes in this pass

- The Invoices list has "Show more" instead of Previous/Next pages, groups rows by day, and puts the Source filter behind the button in the search field.
- Home has an inline "Needs attention" card instead of the right-edge PENDING tab. The floating assistant bubble is gone; it only showed "not copied yet".
- Detail screens use a segmented control for tabs and a bottom sheet for More (tests use `find.byTooltip('More')`).

## Who edits what (13 Oct 2026, while the redesign pass runs)

Two sessions are working in `phone/` at the same time. To avoid overwriting each other:

- **Redesign session (UI only):** `lib/ui/*`, `lib/theme.dart`, `lib/screens/items/*`, `lib/screens/parties/*`, `lib/screens/more/more_screen.dart`, `lib/screens/search/*`, `lib/screens/notifications/*`, `lib/screens/payments/payment_in_screen.dart`, `lib/screens/invoices/{invoices_screen,invoice_detail_screen,record_payment_dialog,invoice_share,bill_saved_screen}.dart`, `lib/shell/{shell_banners,module_settings_sheet,dashboard_overlays,date_range}.dart`, `lib/screens/dashboard_*.dart`, `lib/screens/login_screen.dart`, and the golden tests for those screens.
- **Porting session:** everything else, including `*_logic.dart`, `api.dart`, `session.dart`, `capability.dart`, `more_navigation.dart` and `lib/screens/pages/*`.
- **Shared, re-read before editing:** `lib/shell/app_shell.dart`, `lib/screens/invoices/invoice_form_screen.dart`.

New screens should be built with `lib/ui/kit.dart` and the `AppColors` / `AppText` / `AppSpace` tokens (see "Design system" above).

`test/items_golden_test.dart` still expects "Quotations is not copied to the phone app yet." Quotations now opens `RecordPage`, so the porting session should update that expectation.

- 14 Oct 2026: the redesign session restyled `lib/screens/pages/record_page.dart` (presentation only: header, list rows with ₹ amounts and status dots, empty and error states, hub, detail and calculators). Loading, routing and calculations are unchanged. Please build on the current file rather than an older copy.

## Orders & delivery (14 Oct 2026)
- New screens in `lib/screens/orders/` (orders_screen, order_detail_screen, return_detail_screen, orders_logic). They replace the generic RecordPage for `/orders`.
- Shared file touched: `lib/shell/app_shell.dart` only: `AppTab.orders` now builds `OrdersScreen(embedded: true)`, and `_openFromMore` sends `/orders` to `OrdersScreen` before the page catalogue lookup. `page_catalog.dart` is unchanged.

## Settings redesign (14 Oct 2026)
- New native settings in `lib/screens/settings/` (settings_kit, settings_hub_screen, business_settings, invoice_settings, payments_settings, items_orders_settings, more_settings), following docs/audits/SETTINGS_AUDIT.md.
- `app_shell.dart` `_openFromMore` now sends every `/settings…` link through `settingsGroupForHref()` before the page catalogue, so the generic RecordPage/SettingsEditor is no longer used for settings.
- New bills read `/api/settings/invoice-defaults` (due date, GST-inclusive, round-off, notes, terms); new items read its `lowStockAlert`.

## Parity pass (Nov 2026)

Done 10 to 12 Nov 2026 (commits `d8a6a4d7` to `adb5c57c`, then the Stage 9 close-out). Aim: every link in the More menu opens a designed phone screen, a bottom-bar tab, or the website on purpose. The plain list of fields that used to catch any link (`RecordPage`) is gone. Counts and how they were made: `docs/plan/PHONE_APP.md`. The device checklist is `docs/superpowers/plans/2026-11-10-phone-app-parity-staging-checklist.md`.

### What was built, by stage

- **Stage 0, shared pieces** (`d8a6a4d7`): one table from More link to screen, a document list, a document detail, form fields with a top toast, a table report.
- **Stage 1, repair** (`3a709779` to `185326a3`): Price List and Units & Duplicates, the supplier form, expenses, the journal form, the item form (barcode, category, brand, MRP, photo), tools as a hub of calculators, and every old plain widget moved onto the kit.
- **Stage 2, other sales** (`4212e474` to `f974ead5`): quotations, sales orders, delivery challans, work orders, credit and debit notes, credit approvals, recurring invoices, payment reminders, payment reconciliation.
- **Stage 3, stock** (`00be7df1` to `16b556ed`): party pricing, price levels, schemes, adjustments and repacks, stock transfers, stock counts, held goods, manufacturing, insurance claims, item categories, label printing, stock reports.
- **Stage 4, books** (`8efa1d6f` to `0e40017e`): chart of accounts, ledger, journals, contra, advances, fixed assets, provisions, TDS, bank reconciliation, activity log.
- **Stage 5, reports** (`12bba76e` to `5825b3df`): reports home, 23 sales, purchase and other reports, GST returns, GST cash ledger, e-way bills, PDFs for the statements.
- **Stage 6, people** (`be77c385` to `4aaae3c1`): employees and org chart, attendance, shift roster, leave, salary, advances, employee expenses, commissions, targets, HR dashboard, manager, recruitment, exits, engagement, HR documents, HR reports, tasks, performance.
- **Stage 7, WhatsApp** (`0c6cf6d3` to `51721411`): CRM dashboard, leads, lead sources, pipeline, contacts, groups, unsubscribes, send message (text, picture, buttons), who to message, campaigns and reports, flows, saved replies, order verification.
- **Stage 8, the rest** (`5c6ed962` to `adb5c57c`): supplier dashboard with Propose order, to-do, the small "Opens the website" hint and a better website screen (loading bar, offline state, Back that walks the page's history).
- **Stage 9, close-out:** `RecordPage`, its field formatter and the list catalogue were deleted. A link with no phone screen (an old push link, a search hit) opens the website inside the app, signed in. `routeTier` now returns only `native`, `tab` or `website`, and `route_coverage_test.dart` fails for any More link outside those, or any website link not named in `websiteByDesign`.

### Shared pieces to reuse

- **`TableReportSpec` and `TableReportScreen`** (`lib/screens/reports/table_report_screen.dart`): a report is a spec (route, columns, filters, count tiles) plus one screen that pages, filters and shares. Add a report by writing a spec, not a screen.
- **`openAppHref` and `nativeScreenFor`** (`lib/screens/pages/native_routes.dart`): the one table from website href to phone screen, and the one way to open any website link. Add a screen by adding its href there. `routeTier` reports which of three homes a link has; `rowOpensWebsite` says whether a tap really opens the website.
- **`PayListPage`** (`lib/screens/hr/pay_widgets.dart`) and the document list and detail screens (`lib/screens/sales/`): the shared list and detail layouts for pay and document screens.
- **`askSheet`** (`lib/screens/sales/doc_action_sheets.dart`) and **`showReasonSheet`** (`lib/ui/kit.dart`): the confirm and ask-for-a-reason sheets. Every destructive or ledger-changing action asks first, names what will change, and sends the reason the server records.
- **`AuthedImage`** (`lib/ui/authed_image.dart`): loads an image from a signed-in API path (payment screenshots, photos). A plain network image cannot, because the path is relative and needs the session.
- **`KWebsiteHint`** (`lib/ui/kit.dart`): the small globe and "Opens the website" under a row, shown only when the tap really opens the website (`rowOpensWebsite`), never on a row that has a phone screen.
- **`Capabilities` gating** (`lib/capability.dart`): plan and role checks. Hide what the role cannot do; show a lock where the plan does not include it. The server still checks; the phone must not be the only guard.
- **`websiteByDesign`** (`lib/screens/pages/page_catalog.dart`): the few pages kept on the website (designers, wizards, long forms). A link added there opens the website. Use it rarely and say why in the commit.

### Server tenant-scope fixes made along the way

The phone now calls many routes the website used only through its own forms. Each time a route trusted a business id from the client, or took a record id without checking its business, it was fixed in the same task, with Jest tests. The website is unchanged for honest callers.

- Credit approvals approve and reject, GSTR-2B decision and reconcile, employee create, supplier dashboard, thresholds and analytics: the business comes from the session; a mismatch is still refused.
- GSTR-2B decision: ownership check before the write.
- Shift roster change, roster absent, bulk shift assignment and the roster read: another business's employee or shift is a 404.
- Salary payment, salary advance, commissions approve, pay and cancel: another business's employee is a 404; the approver comes from the session; a locked period is refused before a salary payment is saved.
- Exit checklist update, convert candidate to employee (reporting manager), interviewer on an interview: scoped to the business.
- Tasks: a task cannot be assigned to another business's employee, and the assignee name is not read across businesses.
- Merged from the website-fix branch: item batch, serial and valuation settings are saved; bank accounts and leave balances take the business from the login.

### Open owner follow-ups

From the ledger's owner notes and the checklist's "Known and separate":

- Push links with a query string (`/orders?view=returns&return=…`, `/settings/online-store/orders?khata=pending`) and `/purchase-orders/<id>` open the website; they could map to the phone's orders and purchase screens.
- There is no route to fetch a single stock transfer (F-019).
- Server: `recordDecision` in `lib/gst/gstr2b-reconciliation.ts` has no business check of its own (the route checks first).
- Server: a salary payment is still not saved in one step; a failure after it is saved can leave it without a journal entry.
- Server: the `/api/tasks` routes have no permission check; starting an exit is not limited to HR; the employee routes do not check the HR plan for manager, PAN, Aadhaar and PF/ESI fields; supply-order proposals ignore `allow_low_stock_access`; approving a WhatsApp order accepts any un-invoiced order of the business.
- Server: campaign button clicks always show 0 (`button_clicked_id` is never written); a stock transfer has no repeat-save protection; the journal edit drops each line's own reference; depreciation has no preview.
- Website: the currency converter applies rates backwards and the PAN validator reads the holder type from the wrong letters (the phone is correct); the credit-note Edit link and the payment reminders History tab lead nowhere; editing a paused scheme makes it active; the TDS pages send a year no saved financial year matches, and the TDS certificate PDF route may ask for missing columns; the activity log drops the last day of a range; Workflow automation saves nothing because there is no workflows backend.
- Phone: `settings_router.dart` still sends `business_id` in some request bodies (the server must ignore it; they should be removed). The old party-price screen in that file is dead code.
- Phone: work order "Create Invoice" posts the final invoice straight away; the stock dashboard page (reorder, ageing, velocity) and the Profit & Loss earnings rows are website-only; owner-side poll voting, template delete, onboarding tasks and portal invites are website-only.
- Dates: `entry_date` may arrive as a UTC timestamp and be shown a day early; check on staging.
- Not yet done: the Stage 9 walk on a device with an owner and a restricted staff account (steps 201 to 224 of the checklist), a staging deploy of the server changes above, and a production deploy.
- Tests: the full phone suite has two known failures that are older than this pass: `banners_test.dart` "banner styles and promotion modal" and `invoices_golden_test.dart` "payment status and amounts match the website".
