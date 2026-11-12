# Phone App Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every link in the phone app's More menu, and every screen reached from it, opens a designed phone screen with the actions a shop owner needs, so that no link opens the automatic read-only list, an error, or an unexplained website page.

**Architecture:** The Flutter app in `phone/` keeps calling the existing website APIs; no tax, stock or ledger maths moves to the phone. Stage 0 builds five shared pieces (route table with a coverage test, document list, document detail, form kit, table report). Stages 1 to 8 use those pieces module by module, and each stage ends in an installable staging APK. Stage 9 removes the automatic list from the menu path.

**Tech Stack:** Flutter (Dart), `dio`, `lucide_icons_flutter`, `flutter_test` with golden images; Next.js API routes (TypeScript) for the two small server additions; Jest for the one server-side test.

**Spec:** There is no separate spec. The requirements are the audit of 10 Nov 2026 (entry "Phone app vs website coverage audit" in `docs/project.log.md`), restated in "Scope" below, plus `docs/design/PHONE_APP_HANDOFF.md` (design rules) and `docs/plan/PHONE_APP.md` (route list per module).

## Global Constraints

- Flutter is not on PATH. Call it as `C:\Users\Abhishek\flutter\bin\flutter.bat`, from `phone/`.
- Checks for every task: `flutter analyze` reports no issues, and `flutter test` passes. Golden images change only on purpose, with `flutter test --update-goldens <file>`.
- New screens use `lib/ui/kit.dart` and the `AppColors`, `AppText`, `AppSpace`, `AppRadius` tokens. No `Tw.*`, no hex colours, no raw `AppBar`, `FilledButton`, `DropdownButtonFormField`, `ListTile` or `InputDecoration(labelText:)`.
- One primary action per screen: `KFab` on a list, `KBottomBar` on a detail or form. Row actions open from a long press as a sheet (`showKSheet`, `KSheetAction`). Status is a dot and a word in lists (`KStatusDot.status`) and a `KPill` in headers.
- The phone never sends `business_id`, `user_id` or `created_by` in a request body. The one existing exception is the GSTR-2B reconcile GET, which names the business in the query and the server checks it against the session.
- The phone never computes GST, stock or ledger figures. Totals shown on a form before saving come from the server preview endpoint where one exists; otherwise the form shows the server's totals after saving.
- Every screen handles five states: loading (`KSpinner`), empty (`KEmptyState`), server error with "Try again", `FEATURE_NOT_IN_PLAN` (lock icon, "Not included in your current plan"), and a refusal on save (the server message in a toast; the form stays filled).
- Labels and wording follow the website page. Dates are `dd MMM yyyy` (`ddMMMyyyy` in `lib/format.dart`); money uses `enIn` with the rupee sign and tabular figures.
- Logic that can be tested without widgets lives in a `*_logic.dart` file next to the screen, as in `lib/screens/hr/leave_logic.dart`.
- No migrations are needed. If one turns out to be needed, write it and stop; never apply it to staging or production.
- Commit only after the owner has said commits are approved for this plan. Stage files by name; never `git add .`. Work is on `main`.
- Testing on a device happens on staging after a deploy, from the checklist each stage writes. Do not run slow local browser checks.
- Append an entry to `docs/project.log.md` at the end of every session.

## Scope

"Phone app" means the owner app built from `phone/lib/main.dart`. The staff check-in app (`main_staff.dart`) and the Capacitor customer app are out of scope.

A link is **done** when all of these hold:

1. It opens a screen built with the kit, not `RecordPage`'s automatic list.
2. The list has search, the website's status filters, and "Show more" when the API pages.
3. A row opens a designed detail screen, not a field dump.
4. Create, edit, cancel or delete, and the website's main row actions work, or the row is listed under "Stays on the website" below.
5. The five states in Global Constraints are handled.
6. It has a logic test and one widget test, and its href is gone from `stillGeneric` (Task 1).

### Stays on the website (opens inside the app, on purpose)

These need a large screen, a file from a computer, or a visual editor. Each opens through `WebsitePageScreen` from a row that says so. The owner should confirm this list before Stage 8.

| Page | Reason |
|---|---|
| `/settings/online-store/studio`, `/settings/online-store/themes/**` | Visual store editor |
| `/settings/label-templates/new`, `/settings/label-templates/[id]`, `/settings/templates/design` | Drag-and-drop designers |
| `/whatsapp/flows/[id]` | Flow diagram editor (the flow list is native) |
| `/reports/builder` | Column builder for wide tables |
| `/bank/import`, `/hr/leaves/import-balances`, `/whatsapp/contacts` import, `/eway-bills` import | Spreadsheet upload |
| `/settings/backup` restore | Previewed on the website before replacing data |
| `/opening-balances/setup`, `/hr/leaves/year-end` | Once-a-year wizards |
| `/reports/profit-loss/validation`, `/reports/profit-loss/schedule-iii`, `/reports/gst/gstr9` | Wide statutory tables |
| `/tools/image-background-remover`, `/tools/image-size-reducer`, `/tools/whatsapp-group-extractor` | Desktop tools |
| `/docs`, `/support`, `/privacy` | Website content |

Not ported at all: `/debug/*`, `/invoices/mock`.

## Review Focus

1. **A list with thousands of rows.** The owner expects the first page fast and "Show more" for the rest, not a spinner while every row downloads. Pinned in Task 2 (`DocListScreen` pages when the reply has `pagination`).
2. **A save refused by the server** (locked period, GST-filed month, credit limit, duplicate number). The owner expects the server's sentence and the form still filled in. Pinned in Task 4 (`KFormScaffold` keeps state on `ApiException`).
3. **A staff user without permission for a module.** The owner expects the row hidden or locked, not an error page. Pinned in Task 1 (route test with a 403 reply shows the "no access" state) and reused by every list.
4. **A reply shaped differently from what the screen expects** (a missing key, `null` amount, a number sent as a string). The owner expects a blank cell, never a red error screen. Pinned in Task 2 (`docNum` and `docText` readers) and Task 5 (`TableReportScreen` with a malformed row).
5. **A double tap on Save or on an action such as Approve.** The owner expects one record. Pinned in Task 4 (`KFormScaffold` disables the bar while saving) and Task 3 (`DocAction` runs once while busy).

---

## File map

New shared files (Stage 0):

| File | Responsibility |
|---|---|
| `phone/lib/screens/pages/native_routes.dart` | The one place that maps a website href to a phone screen |
| `phone/lib/screens/docs/doc_list_screen.dart` | List of documents: search, chips, paging, row sheet, create button |
| `phone/lib/screens/docs/doc_detail_screen.dart` | One document: header, facts, lines, totals, history, actions |
| `phone/lib/screens/docs/doc_logic.dart` | Safe readers for reply fields; filter and paging helpers |
| `phone/lib/ui/form_kit.dart` | Form fields and the form scaffold, in the kit's look |
| `phone/lib/ui/toast.dart` | Top toast replacing SnackBars |
| `phone/lib/screens/reports/table_report_screen.dart` | A report made of headline tiles and a table of rows, with a period bar |
| `phone/test/fixtures/more_hrefs.dart` | Every href the server can put in the More menu |
| `phone/test/route_coverage_test.dart` | Fails when a menu href has no decided home |
| `tests/lib/phone-more-hrefs.test.ts` | Fails when the website menu gains a link the phone fixture lacks |

Per module, screens go in the existing folder for that module (`lib/screens/sales/`, `stock/`, `accounting/`, `reports/`, `hr/`, `chats/`, `tools/`), one file per screen and one `*_logic.dart` per module area. Tests go in `phone/test/<module>_test.dart`.

---

## Stage 0: Foundation

### Task 1: Route table and coverage test

**Files:**
- Create: `phone/lib/screens/pages/native_routes.dart`
- Create: `phone/test/fixtures/more_hrefs.dart`, `phone/test/route_coverage_test.dart`, `tests/lib/phone-more-hrefs.test.ts`
- Modify: `phone/lib/shell/app_shell.dart:161-248` (`_openFromMore`), `phone/lib/screens/pages/record_page.dart:796-807` (`dedicatedPageScreen` moves out), `phone/lib/screens/pages/page_catalog.dart`

**Interfaces:**
- Produces:
  - `Widget? nativeScreenFor(AppSession session, String href, {Capabilities? capabilities})`: the screen for an href, or null. It holds everything `_openFromMore` pushes today (payments in and out, supplier and expense forms, aging, orders, the hub screens, the three purchase lists, settings through `phoneSettingPage` and `settingsGroupForHref`) and everything in `dedicatedPageScreen`. Query strings matter: `/supply-orders?role=vendor` is matched before the query is stripped.
  - `enum RouteTier { native, tab, website, generic, none }` and `RouteTier routeTier(AppSession session, String href)`.
  - `const stillGeneric = <String>{...}` in `page_catalog.dart`: every More href that opens the automatic list today. Later tasks delete entries.
  - `const websiteByDesign = <String>{...}` in `page_catalog.dart`: the "Stays on the website" table. It replaces `_webOnly`.
  - `const moreHrefs = <String>[...]` in the fixture: all hrefs from `lib/more-navigation.ts`, `lib/navigation/sales-nav-items.ts`, `lib/navigation/connect-nav-items.ts` and `lib/hr/hr-admin-nav.ts`.
- `dedicatedPageScreen` stays as a one-line forwarder to `nativeScreenFor` so existing tests keep passing.

- [ ] **Step 1: Write the failing tests** in `route_coverage_test.dart`:

```dart
test('every More link has a decided home', () {
  for (final href in moreHrefs) {
    final tier = routeTier(session, href);
    expect(tier, isNot(RouteTier.none), reason: href);
    if (tier == RouteTier.generic) expect(stillGeneric, contains(href), reason: '$href fell back to the automatic list');
  }
});
test('stillGeneric holds no link that already has a screen', () {
  for (final href in stillGeneric) {
    expect(nativeScreenFor(session, href), isNull, reason: href);
  }
});
test('hub and purchase links keep their screens', () {
  expect(nativeScreenFor(session, '/supply-orders?role=vendor'), isA<SupplyOrdersScreen>());
  expect(nativeScreenFor(session, '/purchases'), isA<PurchaseSectionScreen>());
  expect(nativeScreenFor(session, '/reports/aging/payables'), isA<AgingReportScreen>());
  expect(routeTier(session, '/invoices'), RouteTier.tab);
  expect(routeTier(session, '/docs'), RouteTier.website);
});
```

- [ ] **Step 2: Run** `flutter test test/route_coverage_test.dart`. Expected: fails to compile (`native_routes.dart` missing).
- [ ] **Step 3: Implement** `nativeScreenFor`, `routeTier`, the two sets and the fixture. `_openFromMore` becomes: search, tab links, `nativeScreenFor`, then `pageForHref`, then `openWebsiteInApp`.
- [ ] **Step 4: Write** `tests/lib/phone-more-hrefs.test.ts`: call `buildMoreMenuSections` with every module enabled, `isSupplier: true`, and a capability check that allows everything; read `phone/test/fixtures/more_hrefs.dart` as text; expect every menu href to appear in it. Run `npx jest tests/lib/phone-more-hrefs.test.ts`. Expected: pass.
- [ ] **Step 5: Run** `flutter analyze` and `flutter test`. Expected: no issues, all pass.
- [ ] **Step 6: Commit** `phone: one route table for More links, with a coverage test`.

### Task 2: Document list

**Files:**
- Create: `phone/lib/screens/docs/doc_logic.dart`, `phone/lib/screens/docs/doc_list_screen.dart`
- Test: `phone/test/doc_list_test.dart`

**Interfaces:**
- Produces in `doc_logic.dart`:
  - `num? docNum(dynamic v)` (accepts `num` or numeric string, else null), `String docText(dynamic v)` (scalars only, else `''`), `DateTime? docDate(dynamic v)`.
  - `List<Map<String, dynamic>> docRows(dynamic body, String listKey)`.
  - `({int page, int totalPages})? docPaging(dynamic body)`: reads `pagination.page` and `pagination.totalPages` (also `total_pages`); null when absent.
  - `List<Map<String, dynamic>> filterDocs(List<Map<String, dynamic>> rows, String query, List<String> keys)`.
- Produces in `doc_list_screen.dart`:

```dart
class DocListSpec {
  const DocListSpec({
    required this.title, required this.href, required this.path, required this.listKey,
    required this.titleOf, this.subtitleOf, this.amountOf, this.statusOf,
    this.searchKeys = const [], this.filters = const [], this.filterParam = 'status',
    this.icon = LucideIcons.fileText, this.emptyTitle, this.emptyBody,
    this.createLabel, this.onCreate, this.onOpen, this.rowActions,
  });
  final String title, href, path, listKey;
  final String Function(Map<String, dynamic> row) titleOf;
  final String Function(Map<String, dynamic> row)? subtitleOf;
  final num? Function(Map<String, dynamic> row)? amountOf;
  final String? Function(Map<String, dynamic> row)? statusOf;
  final List<String> searchKeys;
  final List<(String value, String label)> filters; // first entry is the default; '' means all
  final String filterParam;
  final IconData icon;
  final String? emptyTitle, emptyBody, createLabel;
  final Future<bool?> Function(BuildContext context)? onCreate;   // true = saved, reload
  final Future<bool?> Function(BuildContext context, Map<String, dynamic> row)? onOpen;
  final List<DocAction> Function(Map<String, dynamic> row)? rowActions;
}
class DocAction {
  const DocAction(this.label, this.icon, this.run, {this.danger = false});
  final String label; final IconData icon; final bool danger;
  final Future<bool?> Function(BuildContext context) run; // true = reload
}
class DocListScreen extends StatefulWidget { const DocListScreen({super.key, required this.session, required this.spec, this.embedded = false}); }
```

- Behaviour: `KBackBar(title)` unless embedded; `KSearchField`; `KChipBar` when `filters` is not empty (sends `?<filterParam>=<value>`); rows grouped by day when the row has a date; long press opens `rowActions` in a sheet; `KFab(createLabel)` when `onCreate` is set; "Show more" appends the next page when `docPaging` says there is one (sends `page=<n>`); pull to refresh; a 403 reply shows "You do not have access to this" with no retry button.

- [ ] **Step 1: Write the failing tests** (use `fakeSession` from `test/hr_connect_screens_test.dart`; move it to `test/support/fake_session.dart` and import it from both):

```dart
test('readers never throw on odd values', () {
  expect(docNum('12.50'), 12.5); expect(docNum({'a': 1}), isNull); expect(docNum(null), isNull);
  expect(docText(['x']), ''); expect(docText(7), '7');
});
test('paging is read from the reply', () {
  expect(docPaging({'pagination': {'page': 1, 'totalPages': 3}}), (page: 1, totalPages: 3));
  expect(docPaging({'rows': []}), isNull);
});
testWidgets('Show more asks for page 2 and appends', ...);            // 2 requests, 4 rows shown
testWidgets('a chip sends its filter', ...);                          // last request query has status=draft
testWidgets('long press lists the row actions', ...);
testWidgets('a 403 shows the no-access state without Try again', ...);
testWidgets('a row with a null amount and a list as status still draws', ...);
```

- [ ] **Step 2: Run** `flutter test test/doc_list_test.dart`. Expected: fails to compile.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** the test, then `flutter analyze`. Expected: pass, no issues.
- [ ] **Step 5: Commit** `phone: shared document list`.

### Task 3: Document detail

**Files:**
- Create: `phone/lib/screens/docs/doc_detail_screen.dart`
- Test: `phone/test/doc_detail_test.dart`

**Interfaces:**
- Consumes: `docNum`, `docText`, `docDate`, `DocAction` (Task 2).
- Produces:

```dart
class DocLine { const DocLine(this.title, {this.subtitle = '', this.amount}); final String title, subtitle; final num? amount; }
class DocDetailSpec {
  const DocDetailSpec({
    required this.title, required this.load, required this.numberOf, this.statusOf, this.partyOf, this.amountOf,
    this.facts, this.lines, this.totals, this.primary, this.actions, this.historyPath,
  });
  final String title;
  final Future<Map<String, dynamic>> Function(KhatarioApi api) load;       // returns the document map
  final String Function(Map<String, dynamic> doc) numberOf;
  final String? Function(Map<String, dynamic> doc)? statusOf, partyOf;
  final num? Function(Map<String, dynamic> doc)? amountOf;
  final List<(String label, String value)> Function(Map<String, dynamic> doc)? facts;   // empty values are dropped
  final List<DocLine> Function(Map<String, dynamic> doc)? lines;
  final List<(String label, num? amount)> Function(Map<String, dynamic> doc)? totals;
  final DocAction? Function(Map<String, dynamic> doc)? primary;              // shown in KBottomBar
  final List<DocAction> Function(Map<String, dynamic> doc)? actions;         // shown under "More"
  final String? Function(Map<String, dynamic> doc)? historyPath;            // GET, rows drawn with DetailHistoryTimeline
}
class DocDetailScreen extends StatefulWidget { const DocDetailScreen({super.key, required this.session, required this.spec, this.seed}); final Map<String, dynamic>? seed; }
```

- Behaviour: draws `seed` at once when given, then replaces it with `load`'s result; header shows number, `KPill` status, party, large amount; an action runs once while busy, shows the server message on `ApiException`, reloads on true, and pops with `true` when the document changed so the list reloads.

- [ ] **Step 1: Write the failing tests:** header shows number, party and status; facts with empty values are not drawn; a double tap on the primary action sends one request; an action that throws `ApiException('Period is locked')` shows that text and leaves the screen open; `seed` is visible before `load` completes.
- [ ] **Step 2: Run** `flutter test test/doc_detail_test.dart`. Expected: fails to compile.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test and `flutter analyze`. Expected: pass.
- [ ] **Step 5: Commit** `phone: shared document detail`.

### Task 4: Form kit and toast

**Files:**
- Create: `phone/lib/ui/form_kit.dart`, `phone/lib/ui/toast.dart`
- Test: `phone/test/form_kit_test.dart`

**Interfaces:**
- Produces in `toast.dart`: `void showKToast(BuildContext context, String message, {KTone tone = KTone.neutral})`, shown at the top for 3 seconds, one at a time.
- Produces in `form_kit.dart`:
  - `KTextField({required String label, required TextEditingController controller, String? hint, String? error, int maxLines = 1, TextInputType? keyboard, bool caps = false, ValueChanged<String>? onChanged})`
  - `KAmountField({required String label, required TextEditingController controller, String? error})` (decimal keyboard, rupee prefix, tabular figures)
  - `KDateField({required String label, required DateTime? value, required ValueChanged<DateTime> onChanged, DateTime? first, DateTime? last})`
  - `KPickField<T>({required String label, required T? value, required List<(T, String)> options, required ValueChanged<T> onChanged, bool searchable = false})` (opens `showKPicker`)
  - `KAsyncPickField({required String label, required String? valueLabel, required Future<List<(String id, String label, String sub)>> Function(String query) search, required void Function(String id, String label) onPicked})` (for customer, supplier, item, account, employee)
  - `KToggleField({required String label, required bool value, required ValueChanged<bool> onChanged, String? help})`
  - `KFormSection({required String title, required List<Widget> children})`
  - `KFormScaffold({required String title, required String saveLabel, required Future<void> Function() onSave, required List<Widget> children, bool dirty = false})`: `KBackBar`, scrolling body, `KBottomBar` with the save button. While `onSave` runs the button shows a spinner and ignores taps. On `ApiException` it shows `e.message` with `showKToast(tone: KTone.negative)` and keeps every field. When `dirty` and the user goes back it asks "Discard changes?".
  - Party, item and account searches used by several forms: `Future<List<(String, String, String)>> searchCustomers(KhatarioApi api, String q)`, `searchSuppliers`, `searchItems`, `searchAccounts`, `searchEmployees`, reading `/api/customers?search=`, `/api/suppliers?search=`, `/api/items/search?q=`, `/api/accounts`, `/api/employees`.

- [ ] **Step 1: Write the failing tests:** `KFormScaffold` sends one save for two fast taps; a refused save shows the server text and the typed value is still in the field; back on a dirty form asks before leaving; `KAmountField` shows the rupee sign; `KPickField` shows the chosen label.
- [ ] **Step 2: Run** `flutter test test/form_kit_test.dart`. Expected: fails to compile.
- [ ] **Step 3: Implement.** Field look: filled `AppColors.surface`, 1.5px `AppColors.hairline` border, 2px `AppColors.brand` when focused, radius `AppRadius.md`, label above the field in `AppText.label`.
- [ ] **Step 4: Run** the test and `flutter analyze`. Expected: pass.
- [ ] **Step 5: Commit** `phone: form kit and top toast`.

### Task 5: Table report

**Files:**
- Create: `phone/lib/screens/reports/table_report_screen.dart`
- Modify: `phone/lib/screens/reports/report_period.dart` (add month and financial-year modes)
- Test: `phone/test/table_report_test.dart`

**Interfaces:**
- Consumes: `ReportPeriod`, `ReportPeriodBar` (existing), `docNum`, `docText`.
- Produces:

```dart
enum ReportPeriodKind { none, range, month, financialYear, asOn }
class ReportColumn { const ReportColumn(this.label, this.key, {this.money = false, this.qty = false}); }
class TableReportSpec {
  const TableReportSpec({
    required this.title, required this.path, this.period = ReportPeriodKind.range,
    this.tiles = const [], this.countTiles = const {}, required this.rowsKey, required this.rowTitle, this.rowSubtitle,
    required this.rowAmountKey, this.columns = const [], this.extraQuery, this.onOpenRow, this.sections = const [],
  });
  final String title, path, rowsKey, rowAmountKey;
  final ReportPeriodKind period;
  final List<(String label, String key)> tiles;                 // dotted keys, e.g. 'summary.total_sales'
  final Set<String> countTiles;                                 // tile keys drawn as plain numbers, no rupee sign
  final String Function(Map<String, dynamic> row) rowTitle;
  final String Function(Map<String, dynamic> row)? rowSubtitle;
  final List<ReportColumn> columns;                             // shown when a row is opened
  final String Function()? extraQuery;
  final void Function(BuildContext context, Map<String, dynamic> row)? onOpenRow;
  final List<(String title, String rowsKey)> sections;          // extra tables in the same reply
}
class TableReportScreen extends StatefulWidget { const TableReportScreen({super.key, required this.session, required this.spec}); }
```

- Query per kind: `range` sends `from_date` and `to_date`; `month` sends `month` and `year`; `financialYear` sends `financial_year=2026-27`; `asOn` sends `as_on_date`. The period bar offers This month, Last month, This quarter, This FY, Last FY and Custom for `range`.
- Behaviour: tiles in a two-column grid of `KCard` with `KAmount`; rows in one `KCard` with search; tapping a row opens a sheet listing `columns` unless `onOpenRow` is set; a tile or cell whose key is missing shows a dash.

- [ ] **Step 1: Write the failing tests:** each kind builds the query above for 17 Oct 2026; a row `{'name': null, 'total': 'abc'}` draws a dash and does not throw; changing the period sends a new request; tiles read dotted keys.
- [ ] **Step 2: Run** `flutter test test/table_report_test.dart`. Expected: fails to compile.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test and `flutter analyze`. Expected: pass.
- [ ] **Step 5: Commit** `phone: shared table report`.

---

## Stage 1: Repair what is built

Each task: write the logic test, see it fail, build, run `flutter test` and `flutter analyze`, commit.

### Task 6: Two broken menu links

**Files:** Create `phone/lib/screens/stock/price_list_screen.dart`, `phone/lib/screens/stock/item_cleanup_screen.dart`, `phone/lib/screens/stock/pricing_logic.dart`. Modify `native_routes.dart`. Test `phone/test/pricing_test.dart`.

- `/pricing/price-list` → `PriceListScreen`: pick a customer (`KAsyncPickField`, `searchCustomers`), then list items with the price that customer gets from `POST /api/pricing/resolve`, as the website page does; search by item name. Read-only, with "Edit party prices" opening Task 20's screen.
- `/items/cleanup` → `ItemCleanupScreen`: duplicate groups from `GET /api/items/merge`; tapping a group shows the items, lets the user choose the one to keep, and sends `POST /api/items/merge` after a confirm sheet that names how many items will be merged.
- Tests: `resolveRequestBody(customerId, itemIds)` matches the website's body; `mergeBody(keepId, group)` excludes the kept id; both hrefs return their screens from `nativeScreenFor`.

### Task 7: Supplier form and supplier edit

**Files:** Rewrite `phone/lib/screens/parties/supplier_form_screen.dart`; create `phone/lib/screens/parties/supplier_form_logic.dart`; modify `supplier_detail_screen.dart:128` (Edit opens the form with the supplier). Test `phone/test/supplier_form_test.dart`.

- `SupplierFormScreen({required AppSession session, Map<String, dynamic>? supplier})`. Create: `POST /api/suppliers`. Edit: `PUT /api/suppliers/[id]`.
- Fields, in sections as on `app/(app)/suppliers/new/page.tsx`: name, phone, email, GSTIN (validated with `isValidGstin`; a valid GSTIN fills state and PAN), PAN, billing address, city, state (default: the business's state from `session`, not Karnataka), pincode, opening balance with a To pay / To receive switch, payment terms (days), bank account name, number, IFSC, UPI id, notes. Read the web page for the exact body keys and copy them.
- Tests: `supplierBody(...)` omits empty optionals and sends `opening_balance_type` `credit` for To pay; an edit body carries only changed keys; default state equals the session business state.

### Task 8: Expense form, expense list and detail

**Files:** Rewrite `phone/lib/screens/expenses/expense_form_screen.dart`; create `expenses_screen.dart`, `expense_logic.dart`, `expense_categories_screen.dart` in the same folder. Modify `native_routes.dart`. Remove `/expenses`, `/expenses/categories` from `stillGeneric`. Test `phone/test/expenses_test.dart`.

- Form fields as on `app/(app)/expenses/new/page.tsx`: category (`GET /api/expense-categories`, with "Add category" posting to the same path), amount, GST rate and whether the amount includes GST, supplier (optional), paid from (cash, bank account, UPI, on account), date, bill number, description, photo of the bill. Totals under the form come from `POST /api/expenses/preview`.
- List: `DocListScreen` on `GET /api/expenses` (`expenses`), grouped by day, month total in a header tile, filter chips by category. Row opens a detail with Edit (`PUT /api/expenses/[id]`) and Delete (`DELETE`, confirm sheet).
- Categories: list with add and rename (`PATCH /api/expense-categories/[id]`).
- Tests: body for an inclusive-GST expense; preview totals are shown, not computed; delete asks first.

### Task 9: Journal form restyle and journal templates

**Files:** Rewrite `phone/lib/screens/accounting/journal_form_screen.dart` on the form kit; create `journal_logic.dart`. Test `phone/test/journal_test.dart`.

- Lines are cards with account (`KAsyncPickField`, `searchAccounts`), Debit / Credit switch and amount. A footer shows total debit, total credit and the difference; Save is disabled until they match and there are at least two lines. "Use a template" lists `GET /api/journal-entries/templates` and fills the lines.
- Tests: `journalBalanced(lines)`; `journalBody(...)` keeps `debit` or `credit` at 0 on the other side; a template fills lines.

### Task 10: Item form fields

**Files:** Modify `phone/lib/screens/items/item_form_screen.dart`, `item_form_logic.dart`. Test: extend `phone/test/item_form_test.dart`.

- Add, in an "Identify" section: barcode (with a scan button using the existing scanner in `scan_add_screen.dart`), category (`GET /api/categories`), brand, MRP. In "Stock": track batch, track serial, default supplier, pack size and pack unit, valuation method (only when the website shows it). In "Photos": main image through `KhatarioApi.uploadImage`. Body keys: `barcode`, `category_id`, `brand`, `mrp`, `track_batch`, `track_serial`, `default_supplier_id`, `pack_size`, `pack_unit`, `image_url`.
- Variants and bundles keep opening the website, from a row that says so.
- Tests: `itemCreateBody` includes the new keys only when set; an edit of an item that already has a barcode keeps it when the field is untouched.

### Task 11: Calculators

**Files:** Create `phone/lib/screens/tools/calculators_screen.dart`, `calculator_logic.dart`, `tools_hub_screen.dart`. Remove the `_simpleCalc`, `_idCheck`, `_gstCalculator`, `_hsnFinder`, `_leads` branches from `record_page.dart`. Test `phone/test/calculators_test.dart`.

- One screen per tool with its own labelled fields: Discount (price, discount %), EMI (loan amount, yearly interest %, months), Interest (principal, rate, time, simple or compound), Price margin (cost, selling price, or cost and margin %), TDS (amount, section rate), Currency (amount, rate), Invoice number (prefix, next number, padding), GST, GSTIN, PAN, HSN finder, Lead extractor.
- `/tools` → `ToolsHubScreen`, a grid of `KIconTile`.
- Tests: `emi(100000, 12, 12)` rounds to 8884.88; margin on selling price; GST inclusive split for 118 at 18% gives 100 and 18.

### Task 12: Restyle old-style screens

**Files:** the heaviest are `phone/lib/screens/purchases/bill_form_screen.dart`, `purchase_section.dart`, `purchase_tools.dart`, `phone/lib/screens/orders/order_detail_screen.dart`, `return_detail_screen.dart`, `phone/lib/screens/chats/chat_thread_screen.dart`, `chat_outreach_screens.dart`, `deal_sheet.dart`, `phone/lib/screens/hub/my_catalog_screen.dart`, `incoming_bills_screen.dart`. The test below also flags about twenty files with one to three leftovers each (settings, signup, invoice form, shell); fix those too.

- Replace every `AppBar`, `FilledButton`, `DropdownButtonFormField`, `ListTile` and `InputDecoration(labelText:)` with `KBackBar`, `KButton`, `KPickField`, `KListRow` and the form kit fields. No behaviour change: request bodies and navigation stay as they are.
- Add `phone/test/no_raw_material_test.dart`: reads every file under `lib/screens` and `lib/shell` and fails when one contains `AppBar(`, `FilledButton(`, `DropdownButtonFormField` or `ListTile(`, except files listed in an `allowed` set that this task empties.
- Regenerate the affected goldens on purpose and look at each new image before committing.

### Task 13: Stage 1 release

- [ ] `flutter analyze`, `flutter test`.
- [ ] Build: `C:\Users\Abhishek\flutter\bin\flutter.bat build apk` (default server is staging).
- [ ] Write `docs/superpowers/plans/2026-11-10-phone-app-parity-staging-checklist.md` with a section "Stage 1": one line per screen changed, saying what to tap and what should happen.
- [ ] Log entry; ask the owner to test on the device.

---

## Stage 2: Sales documents

Shared for this stage: `phone/lib/screens/sales/sales_logic.dart` (status labels, row readers) and `phone/test/sales_docs_test.dart`. `BillFormScreen` already saves these kinds; this stage adds the lists, details and actions.

### Task 14: Quotations

**Files:** Create `phone/lib/screens/sales/estimates_screen.dart`. Modify `native_routes.dart`, `stillGeneric`.

- List: `DocListScreen`, `GET /api/estimates` (`estimates`), chips All, Open, Converted, Expired. Create: `InvoiceFormScreen(documentType: 'proforma_invoice')` (exists).
- Detail: `InvoiceDetailScreen` (a quotation is an invoice row). Actions: Convert to invoice (`POST /api/estimates/[id]/convert`, then open the new invoice), Share, Print / PDF, Edit.
- Tests: converted rows offer "Open invoice", not "Convert"; convert opens the id from the reply.

### Task 15: Sales orders

**Files:** Create `phone/lib/screens/sales/sales_orders_screen.dart`.

- List `GET /api/sales-orders` (`salesOrders`); detail `GET /api/sales-orders/[id]` plus `GET /api/sales-orders/[id]/payment-summary` (advance received, balance). Actions: Edit (`PUT`), Convert to invoice (`POST .../convert`), Record advance (opens `PaymentInFormScreen` for the customer), Share.
- Tests: payment summary rows; convert is hidden once fully invoiced.

### Task 16: Delivery challans and work orders

**Files:** Create `phone/lib/screens/sales/delivery_challans_screen.dart`, `work_orders_screen.dart`.

- Challans: list `GET /api/delivery-challans` (`deliveryChallans`); detail `GET /api/delivery-challans/[id]`; actions: Edit (`PUT`), change status (`PATCH`), Settle to invoice (`POST .../settle`), Share. New numbers come from `GET /api/delivery-challans/next-number`.
- Work orders: list `GET /api/work-orders` (`workOrders`); detail `GET /api/work-orders/[id]`; actions: Edit, change status (`PATCH`), Convert (`POST .../convert`). New: add `BillKind.workOrder` to `bill_form_screen.dart` following `app/(app)/work-orders/new/page.tsx`, with `GET /api/work-orders/next-number`.
- Tests: status change bodies; a settled challan has no Settle action.

### Task 17: Credit notes and debit notes

**Files:** Create `phone/lib/screens/sales/credit_debit_notes_screen.dart` (one screen, `debit` flag).

- List `GET /api/credit-notes` (`creditNotes`) and `GET /api/debit-notes` (`debitNotes`). There is no GET by id, so the detail uses the list row as `seed` and `load` re-reads the list filtered by the note's number. Actions: Edit (`PUT /api/<kind>/[id]`), Cancel (`PATCH /api/<kind>/[id]/cancel`, reason sheet), Share / PDF.
- Tests: cancel sends the reason; a cancelled note has no actions; the server's refusal for a GST-filed month is shown.

### Task 18: Credit approvals, recurring invoices, payment reminders, reconciliation

**Files:** Create `phone/lib/screens/sales/credit_approvals_screen.dart`, `recurring_invoices_screen.dart`, `payment_reminders_screen.dart`, `phone/lib/screens/payments/payment_reconciliation_screen.dart`.

- Credit approvals: `GET /api/credit-approvals/pending` (`approvals`); each card has Approve (`POST /api/credit-approvals/approve`) and Reject (`POST .../reject`, reason sheet), in the look of `LeavesScreen`.
- Recurring invoices: `GET /api/recurring-invoices`; detail `GET /api/recurring-invoices/[id]`; Pause, Resume, change next date (`PATCH`), Run now (`POST /api/recurring-invoices/[id]`); create through a form with customer, items copied from an invoice, frequency, start and end.
- Payment reminders (`/payments/reminders` and `/whatsapp/reminders`): overdue invoices from `GET /api/invoices/for-reminders` with checkboxes, "Send reminders" (`POST /api/whatsapp/send-bulk-reminders`), a Sent tab from `GET /api/whatsapp/reminders/logs`, and a banner when `GET /api/whatsapp/status` says WhatsApp is not linked.
- Payment reconciliation: `GET /api/payments?reconciliation=1` (`payment_transactions`); row actions through `POST /api/payments/manual-action` as on the website.
- Tests: reject requires a reason; reminders body lists the ticked invoice ids only; nothing is sent when WhatsApp is not linked.

### Task 19: Stage 2 release

Same steps as Task 13, adding a "Stage 2" section to the checklist. `stillGeneric` must hold no href from the Sales section.

---

## Stage 3: Stock

Shared: `phone/lib/screens/stock/stock_logic.dart`, `phone/test/stock_test.dart`.

### Task 20: Pricing

**Files:** Create `phone/lib/screens/stock/party_pricing_screen.dart`, `price_levels_screen.dart`, `schemes_screen.dart`.

- Party pricing: customer picker, then that customer's item prices from `GET /api/pricing/party-item`; add or change a price (`POST`), history from `GET /api/pricing/history`, category rules from `/api/pricing/party-category`.
- Price levels: `GET /api/pricing/levels`; add (`POST`), delete (`DELETE`); a level opens its rates (`GET` and `POST /api/pricing/levels/[id]/rates`).
- Schemes: `GET /api/pricing/schemes`; add with a form following the web page, delete.
- Remove `/pricing/party-item` from `websiteByDesign`.

### Task 21: Adjustments and repacks

**Files:** Create `phone/lib/screens/stock/adjustments_screen.dart`, `adjustment_form_screen.dart`, `repack_form_screen.dart`.

- List `GET /api/inventory-adjustments` (`adjustments`), with a Repacks chip reading `GET /api/inventory-adjustments/repacks`. Detail `GET /api/inventory-adjustments/[id]` and `.../repacks/[id]` (Cancel repack: `POST .../cancel`).
- New adjustment: multi-item form (item, warehouse, add or reduce, quantity, reason, batch when tracked), `POST /api/inventory-adjustments`. The single-item `adjust_stock_sheet.dart` stays for the item screen; variants and bundles now open this form instead of the website.
- New repack: `GET .../repacks/prefill`, then `POST .../repacks`.

### Task 22: Stock transfers

**Files:** Create `phone/lib/screens/stock/stock_transfers_screen.dart`, `stock_transfer_form_screen.dart`, `stock_transfer_receive_screen.dart`.

- List `GET /api/stock-transfers` (`transfers`), chips by status. Detail reads items from `GET /api/stock-transfers/[id]/items`. Actions by status: Approve (`POST .../approve`), Dispatch (`PATCH .../dispatch`), Receive (screen with received quantity per line, `POST .../receive`), Close short (`POST .../close-short`), Cancel (`PATCH .../cancel`).
- New: from and to warehouse (`GET /api/warehouses`), lines, note; `POST /api/stock-transfers`.
- Tests: the action list for each status; receive body carries per-line quantities; receiving more than was sent is refused before the request.

### Task 23: Stock counts, held goods, manufacturing, insurance claims

**Files:** Create `phone/lib/screens/stock/stock_counts_screen.dart`, `stock_count_screen.dart`, `stock_holds_screen.dart`, `manufacturing_screen.dart`, `insurance_claims_screen.dart`. Add roots `stock-counts`, `stock-holds`, `manufacturing`, `insurance-claims` to `nativeScreenFor`.

- Stock counts: list and start (`GET`, `POST /api/stock-counts`, warehouse picker); a count screen with scan-to-count (`GET /api/stock-counts/[id]/barcodes`), counted quantity per item, save and finish (`PATCH /api/stock-counts/[id]`).
- Held goods: `GET /api/stock-holds` and `GET /api/inward-custody`; add (`POST /api/stock-holds`), release (`POST /api/stock-holds/[id]`).
- Manufacturing: two tabs, Recipes (`/api/manufacturing/boms`) and Production (`/api/manufacturing/production`), each with a list and a create form.
- Insurance claims: `GET`, `POST /api/insurance-claims`, status change `PATCH /api/insurance-claims/[id]`.

### Task 24: Categories, labels, stock reports

**Files:** Create `phone/lib/screens/stock/item_categories_screen.dart`, `print_labels_screen.dart`; `phone/lib/screens/reports/stock_reports.dart`.

- Categories: `GET`, `POST`, `PATCH`, `DELETE /api/categories`, with item counts.
- Print labels: pick a template (`GET /api/label-templates`), pick items and copies, print through `lib/printing/thermal_printers.dart`; "Design a template" opens the website.
- Stock reports as `TableReportSpec` entries: Stock Summary (`/api/reports/stock/summary`, `stock`), Closing Stock (`financialYear`), Stock with Parties (`third-party`), Valuation, Quantity details, Bank stock statement, Job work, FIFO lots, Low stock, Movement, Expiry. Read each API reply for the keys before writing its spec; one test per report loads a recorded reply saved under `phone/test/fixtures/reports/`.

### Task 25: Stage 3 release

As Task 13. No Inventory href left in `stillGeneric`.

---

## Stage 4: Books

Shared: `phone/lib/screens/accounting/books_logic.dart`, `phone/test/books_test.dart`.

### Task 26: Chart of accounts and ledger

**Files:** Create `accounts_screen.dart`, `account_form_screen.dart`, `account_ledger_screen.dart`, `ledger_screen.dart` in `phone/lib/screens/accounting/`.

- Accounts: `GET /api/accounts` grouped by `GET /api/accounts/groups`, with balances; add (`POST`), edit (`PATCH /api/accounts/[id]`), delete (`DELETE`, refused by the server when the account has entries).
- Account ledger: `GET /api/ledger/account/[accountId]` with a period bar, opening and closing balance tiles, running balance per row, PDF through `.../statement/pdf` in the existing PDF viewer. A row opens its source document where the phone has a screen for it.
- Ledger (`/ledger`): all entries from `GET /api/ledger` with period and account filter.

### Task 27: Journal list, contra, advances

**Files:** Create `journal_entries_screen.dart`, `contra_screen.dart`, `advances_screen.dart`.

- Journal: list `GET /api/journal-entries` (`entries`); detail `GET /api/journal-entries/[id]`; actions Edit (`PATCH`), Reverse (`POST .../reverse`), Lock and Unlock (`POST`, `DELETE .../lock`), Delete. Create: Task 9's form.
- Contra: list `GET /api/contra`; form with from account, to account (cash and bank only), amount, date, note; `POST /api/contra`.
- Advances: list `GET /api/advances`; detail `GET /api/advances/[id]`; Adjust against an invoice (`POST .../adjust`), Refund (`POST .../refund`); new advance `POST /api/advances`.

### Task 28: Fixed assets, provisions, TDS

**Files:** Create `fixed_assets_screen.dart`, `provisions_screen.dart`, `tds_screen.dart`.

- Fixed assets: list and add; detail with Depreciate (`POST .../depreciate`) and Dispose (`POST .../dispose`); schedule from `GET /api/fixed-assets/depreciation-schedule`.
- Provisions: list, add, edit, delete; entries per provision (`GET`, `POST /api/provisions/[id]/entries`).
- TDS: tabs Transactions (`/api/tds/transactions`), Payments (`GET`, `POST /api/tds/payments`), Certificates (`GET`, `POST /api/tds/certificates`, PDF), Categories (`/api/tds/categories` with add, edit, delete); summary tiles from `GET /api/tds/reports/summary`.

### Task 29: Bank reconciliation and activity log

**Files:** Create `bank_reconciliation_screen.dart`, `activity_logs_screen.dart`.

- Bank reconciliation: pick an account (`GET /api/bank-accounts`), then unmatched statement lines from `GET /api/bank/reconciliation`; per line: Match to a suggested entry (`POST .../match`), Create entry (`POST .../create-entry`), Ignore (`POST .../ignore`), Undo (`POST .../undo`); "Match automatically" (`POST .../auto-match`); Finish (`POST .../complete`). Importing a statement opens the website.
- Activity log: `GET /api/activity-logs` (`logs`) with user and date filters, grouped by day.

### Task 30: Stage 4 release

As Task 13. No Accounting href left in `stillGeneric`.

---

## Stage 5: Reports

Each report is a `TableReportSpec` unless noted. For each: fetch the API once on staging with a test account, save the reply (with names changed) under `phone/test/fixtures/reports/<name>.json`, write the spec from the real keys, and test that the screen draws the fixture's totals and first row. Do not guess keys.

### Task 31: Reports overview

**Files:** Create `phone/lib/screens/reports/reports_home_screen.dart`.

- `/reports` → a hub: period bar, four headline tiles (sales, purchases, expenses, profit from the same APIs the web overview uses), then report groups as `KListRow`s: Financial, Sales, Purchase, GST, Stock, Party. Locked reports show the lock pill and open the upgrade sheet.

### Task 32: Sales and purchase reports

**Files:** Create `phone/lib/screens/reports/sales_reports.dart`, `purchase_reports.dart`.

- Sales (11): summary, invoice-wise, item-wise, party-wise, tax-wise, payment-mode, discount, credit, cancelled, returns, b2b-b2c, on `/api/reports/sales/<type>`. Invoice rows open `InvoiceDetailScreen`; party rows open `CustomerDetailScreen`; item rows open `ItemDetailScreen`.
- Purchase (7): summary, invoice-wise, supplier-wise, item-wise, returns, credit, tax-wise, on `/api/reports/purchase/<type>`.
- Also Profit by invoice (`/api/reports/profit-by-invoice`), Deleted items (`/api/reports/deleted-items`), Credit risk, Inter-branch reconciliation, Label print log.

### Task 33: GST

**Files:** Create `phone/lib/screens/reports/gst_reports.dart`, `gst_cash_ledger_screen.dart`, `eway_bills_screen.dart`.

- GSTR-1 (`month`): section tiles (B2B, B2C large, B2C small, exports, credit notes, HSN), each opening its rows; "Download Excel" through `/api/reports/gst/gstr1/export/excel`; Mark as filed (`POST .../[filingId]/mark-filed`).
- GSTR-3B (`month`): the 3.1, 4 and 6.1 tables as `StatementSection`s.
- GSTR-2B and 2B reconciliation: summary tiles and matched, missing and mismatched lists; accept or defer per line (`POST /api/gst/gstr2b/decision`). Importing the 2B file opens the website.
- GSTR-1 vs 3B (`/api/reports/gst/reconciliation`) and GST alerts (`/api/gst/compliance-alerts`, with Resolve).
- Cash ledger: balances and entries from `GET /api/gst/cash-ledger` (`asOn`); Deposit (`POST .../deposit`).
- E-way bills: list `GET /api/eway-bills`, detail and status change (`PATCH /api/eway-bills/[id]`), add (`POST`). Add root `eway-bills`.

### Task 34: Statements polish and stage release

- Add PDF and Share to Profit & Loss, Balance Sheet, Trial Balance and Cash Flow (`.../pdf` endpoints), and drill-down on P&L rows through `GET /api/reports/profit-loss/drilldown`.
- Release as Task 13. No Reports href left in `stillGeneric` except those in `websiteByDesign`.

---

## Stage 6: HR

Shared: `phone/lib/screens/hr/hr_logic.dart`, `phone/test/hr_test.dart`.

### Task 35: Employees

**Files:** Create `employee_form_screen.dart`; modify `employees_screen.dart`.

- Add and edit employee (`POST /api/employees`, `PATCH /api/employees/[id]`) with the sections of `app/(app)/employees/new/page.tsx`: personal, job (department and designation from `/api/settings/hr-org-catalog`), pay (`/api/employees/[id]/salary-structure`), bank, login. Deactivate from the profile. Remove `/employees/new` from `websiteByDesign`.
- Org chart (`GET /api/employees/org-chart`): an indented tree with expand and collapse.

### Task 36: Attendance, shifts, leaves

**Files:** Create `attendance_history_screen.dart`, `attendance_reviews_screen.dart`, `shift_roster_screen.dart`, `leave_form_screen.dart`, `leave_calendar_screen.dart`.

- Attendance history: month grid per employee from `GET /api/employees/attendance/matrix`; check-in reviews (`GET`, `POST /api/employees/attendance/reviews`); regularization requests (`/api/employees/attendance-regularization`, approve through `/api/employees/manager/attendance-regularization/[id]`).
- Shift roster: week view from `GET /api/hr/shifts/roster`, change a day (`PATCH`); bulk assign (`POST /api/hr/shifts/bulk-assign`) with employee multi-select.
- Leaves: apply on someone's behalf (`POST /api/employees/leave-requests`, days from `GET /api/hr/leave/preview-days`), balances (`GET /api/employees/leave-balances`), month calendar (`GET /api/employees/leave-calendar`).
- Remove the "Open on website" globe from `AttendanceScreen` and `LeavesScreen`.

### Task 37: Pay

**Files:** Create `salary_payment_form_screen.dart`, `payslip_screen.dart`, `salary_advances_screen.dart`, `employee_expenses_screen.dart`, `commissions_screen.dart`.

- Pay salary: employee, month, prefill from `GET /api/employees/salary/payments/prefill`, then `POST /api/employees/salary/payments`. Payslip: PDF from `/api/employees/salary/payslips/[id]/pdf` with Share.
- Advances: list, new (`POST`), approve (`PATCH .../approve`), balance.
- Employee expenses: list, new with bill photo (`.../attachments`), approve or reject (`PATCH`), voucher PDF.
- Commissions: list and add; targets (`/api/employees/targets`).

### Task 38: Manager, hiring, engagement, exits, HR reports, tasks

**Files:** Create `hr_dashboard_screen.dart`, `manager_screen.dart`, `recruitment_screen.dart`, `engagement_screen.dart`, `exits_screen.dart`, `hr_documents_screen.dart`, `hr_reports_screen.dart`, `tasks_screen.dart`, `performance_screen.dart`.

- HR dashboard: tiles and lists from `GET /api/hr/dashboard/overview`, each tile opening its screen.
- Manager: `GET /api/employees/manager/dashboard`, pending approvals (`.../pending-approvals`) for leave, overtime, regularization and exits, each with Approve and Reject; team list.
- Recruitment: jobs (list, add, edit), candidates per job, candidate profile with stage change, interviews, offer (create, PDF), convert to employee.
- Engagement: announcements, articles, polls, each with list and add.
- Exits: list, start an exit, detail with checklist and approvals.
- HR documents: templates and "Generate for an employee" (`POST .../[id]/generate`).
- HR reports: a hub over `GET /api/hr/reports/[type]` and the statutory ECR, as `TableReportSpec`s.
- Tasks (`/api/tasks`): list by status, add, mark done, delete. Performance: `GET /api/employees/performance`.

### Task 39: Stage 6 release

As Task 13. No HR href left in `stillGeneric`.

---

## Stage 7: WhatsApp

### Task 40: Menu links to existing screens, dashboard, leads

**Files:** Modify `native_routes.dart`; create `phone/lib/screens/chats/connect_dashboard_screen.dart`, `leads_screen.dart`, `lead_sources_screen.dart`.

- `/whatsapp/campaigns` → `BroadcastsScreen`; `/whatsapp/pipeline` → `PipelineScreen`; `/whatsapp/bot-rules` → `BotRepliesScreen` (all exist inside the Chats tab).
- Dashboard: tiles from `/api/whatsapp/dashboard/overview`, `agents`, `campaigns`, `pipeline`.
- Leads: list with stage and source filters, add, lead profile with notes, change stage, Convert to customer (`POST /api/whatsapp/leads/[id]/convert`), new enquiry. Pipeline shows all cards with "Show more" instead of "See all on the website".
- Lead sources: list, add, pause, IndiaMART sync, tracked links.

### Task 41: Audience, sending, flows

**Files:** Create `contacts_screen.dart`, `contact_groups_screen.dart`, `unsubscribes_screen.dart`, `send_message_screen.dart`, `who_to_message_screen.dart`, `flows_screen.dart`, `saved_replies_screen.dart` in `phone/lib/screens/chats/`.

- Contacts: list, add, edit, delete, open chat; groups with members; unsubscribes with add and remove. The Contacts bottom tab uses the new screen.
- Send message: pick contacts or a group, pick a template or type a message, `POST /api/whatsapp/send`. Who to message: suggestions from `GET /api/whatsapp/who-to-message` with a Send button per group.
- Flows: list, publish, unpublish, delete; editing opens the website. Saved replies: list, add, edit, delete.
- Order verification: remove the "Open on website" globe once approve and reject are confirmed to cover the web page.

### Task 42: Stage 7 release

As Task 13. No Connect href left in `stillGeneric`.

---

## Stage 8: Remaining pages

### Task 43: Supplier dashboard, to-do, remaining settings

**Files:** Create `phone/lib/screens/hub/supplier_dashboard_screen.dart`, `phone/lib/screens/tools/todo_screen.dart`; modify `phone/lib/screens/settings/more_settings.dart`.

- Supplier dashboard: `GET /api/suppliers/dashboard` and `.../analytics`, alerts with Dismiss, thresholds.
- To-do: list with stats, add, edit, done, snooze, assign (`/api/todos`, `/todos/users`).
- Settings: Workflow automation list with on and off; the restore row keeps opening the website and says why.

### Task 44: Website pages by design

**Files:** Modify `phone/lib/screens/pages/website_page_screen.dart`.

- Every href in `websiteByDesign` opens from a row that carries a small globe and the words "Opens the website". `WebsitePageScreen` gets a loading bar, an offline state with "Try again", and Back that walks the page's history before leaving.
- Test: each `websiteByDesign` href returns `RouteTier.website`.

---

## Stage 9: Close out

### Task 45: Remove the automatic list from the menu path

**Files:** Modify `page_catalog.dart`, `record_page.dart`, `route_coverage_test.dart`, `docs/plan/PHONE_APP.md`, `docs/design/PHONE_APP_HANDOFF.md`, `docs/roadmap.md`.

- [ ] Change the coverage test to `expect(routeTier(session, href), isIn([RouteTier.native, RouteTier.tab, RouteTier.website]))` for every `moreHrefs` entry; delete `stillGeneric`.
- [ ] `RecordPage` remains only for hrefs that arrive from push notifications or search with no screen; it shows "Open on the website" and no field dump. Delete `appPages` entries and helpers that nothing reads.
- [ ] Run the whole suite, build the APK, and walk every More section on the device with an owner account and a restricted staff account. Record anything found as new tasks rather than widening this one.
- [ ] Rewrite the table at the top of `docs/plan/PHONE_APP.md` with the real counts, add a "Parity pass (Nov 2026)" section to the handoff, move the roadmap card to Done.

---

## Order and size

| Stage | Tasks | What the owner gets |
|---|---|---|
| 0 Foundation | 1–5 | Nothing visible; the pieces every later screen uses |
| 1 Repair | 6–13 | No broken links; full supplier, expense, journal and item forms; one look everywhere |
| 2 Sales | 14–19 | Quotations to credit notes, approvals, reminders |
| 3 Stock | 20–25 | Pricing, adjustments, transfers, counts, stock reports |
| 4 Books | 26–30 | Accounts, ledger, journal, contra, advances, assets, TDS, bank matching |
| 5 Reports | 31–34 | Every sales, purchase and GST report |
| 6 HR | 35–39 | Employees, attendance, leave, pay, hiring |
| 7 WhatsApp | 40–42 | Dashboard, leads, contacts, sending |
| 8 Remaining | 43–44 | Supplier dashboard, to-do, clear website rows |
| 9 Close out | 45 | The automatic list is gone |

Stages 2 to 7 depend only on Stage 0, so their order can change to suit the owner. Stage 1 should stay first because it fixes what users already hit.
