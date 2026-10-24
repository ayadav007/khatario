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
