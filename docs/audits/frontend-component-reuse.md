# Frontend component reuse audit

Date: 2026-10-13  
Scope: the Next.js application in this repository (`app/`, `components/`, `hooks/`, `contexts/`, `lib/`).  
The Flutter app in `phone/` is covered only in the dual-client section. Application source was not modified.

## 1. Executive summary

Khatario has a real shared UI kit, and the signed-in business app mostly uses it. It does not have one component for every repeated pattern. Feature screens still own their own tables, filters, empty copy, date fields, and money formatting.

**Verified.** `components/ui/Button.tsx` is imported by 358 files and 196 pages. `Card` has 239 consumers. `Input` has 186. `components/layout/PageHeader.tsx` has 87. Of 287 pages under `app/(app)`, 221 import something from `components/ui` or `components/layout`.

**Verified.** The same patterns are also rebuilt locally. The scan found 1,634 raw `<button>` tags in 444 files, 945 raw `<input>` tags in 293 files, and 524 native `<select>` tags in 232 files. Six detail panels paste the same `formatINR` function. Invoice document status uses `components/ui/StatusBadge.tsx` (12 consumers). Report pages ship a second `StatusBadge` with different payment coloring. Toasts go through `react-hot-toast`, `components/ui/Toast.tsx`, and `components/ui/EnhancedToast.tsx`.

**Overall.** The split is sensible: a small design system, shared chrome (headers, shell, access denied), and a large set of feature components that should stay local. The maintenance burden is real in three places: money and status display, confirmation UI, and unused “shared” widgets that new screens do not pick up. It is not a codebase of 365 independently designed pages.

This is not a reuse percentage. Import counts do not measure how much of a page’s JSX comes from the kit.

## 2. How the counts were produced

Command, from the repo root:

```bash
node docs/audits/generate-frontend-reuse-inventory.mjs
```

The script walks `app`, `components`, `hooks`, `contexts`, and `lib`. It skips `node_modules`, `.next`, `phone`, `tests`, `*.test.*`, `*.spec.*`, and stories. It records value imports, `import('…')`, and `export { … } from` barrels. `import type` is ignored. A consumer is another scanned file that reaches the module, including through a barrel.

Machine-readable output:

- `docs/audits/frontend-reuse-summary.json`
- `docs/audits/frontend-routes.json`
- `docs/audits/frontend-components.json` (consumer paths capped at 12 samples per file)
- `docs/audits/frontend-top-components.json`
- `docs/audits/frontend-duplicate-names.json`

**Limitations, all verified as method limits:**

- 2,947 files were scanned. Not every feature component was read line by line. Duplication claims below are either exact name collisions from the scan or implementations that were opened.
- `export const Button: React.FC` is not detected as an export name, because the name regex requires `export const Name =`. Import counts for those files are still valid. Button, Card, and Chip show an empty `exports` array for that reason.
- JSX similarity across pages was not computed with an AST clone detector.
- Dynamic `import(variable)` and string-built paths are invisible.
- Test files are not consumers, so a widget used only by tests counts as zero.
- Route groups such as `(app)` are removed when building the URL. Dynamic segments stay as `[id]`. Each `page.tsx` is one route pattern, not one URL per id.

**Coverage.** Route files, `components/ui`, layout chrome, and the pattern searches in section 6 were examined. Feature folders were counted and sampled (invoice composer, detail panels, WhatsApp confirm, report UI, mock invoice). WhatsApp (64 component files) and marketing (54) were not read file by file.

## 3. Route and page inventory

| Kind | Count | Meaning |
|---|---:|---|
| `page.tsx` files | 365 | One file, one route pattern |
| Distinct route paths after removing route groups | 365 | No two page files collapsed to the same path |
| `layout.tsx` | 15 | See list below |
| `app/api/**/route.ts` | 890 | HTTP handlers, not screens |
| Component `.tsx` files | 548 | Excludes pages, layouts, loading, and error files |

Page files by route group:

| Group | Pages |
|---|---:|
| `app/(app)` | 287 |
| `app/` outside a group (marketing, admin, store, partners, login, and similar) | 60 |
| `app/(public-business)` | 15 |
| `app/(customer)` | 3 |

Layouts: `app/layout.tsx`, `app/(app)/layout.tsx`, `app/(app)/settings/layout.tsx`, `app/(app)/reports/layout.tsx`, `app/(app)/items/layout.tsx`, `app/(app)/employees/layout.tsx`, `app/(app)/settings/whatsapp/layout.tsx`, `app/admin/layout.tsx`, `app/store/layout.tsx`, `app/store/products/[id]/layout.tsx`, `app/partners/layout.tsx`, `app/guides/layout.tsx`, `app/(public-business)/layout.tsx`, `app/(public-business)/[slug]/employees/layout.tsx`, `app/(customer)/layout.tsx`.

Providers live in `contexts/` (17 files), including `AuthContext`, `BranchContext`, `ToastContext`, `LayoutContext`, and `FeatureUpgradeModalContext`. Data hooks live in `hooks/` (`useEntityList`, `useEntityMutation`, `useEntityQuery`, `useToast`, and others). `useEntityList` is imported by 3 files, so list fetching is mostly written on the page.

There is no `components.json` and no shadcn generator. The kit is local: `components/ui/*` plus utility classes in `app/globals.css` (`.button-primary`, `.type-label`, `--space-card-*`). `clsx` is the class helper. Radix packages are dependencies (`react-dialog`, `react-dropdown-menu`, `react-select`, `react-toast`, `react-tabs`). Source imports of `@radix-ui` are only `react-tabs`, on `app/(app)/reports/gst/gstr1/page.tsx` and `gstr2b/page.tsx`.

`npm run check` already guards three visual rules: `scripts/check-raw-primary-ui.mjs`, `scripts/check-mobile-page-chrome.mjs`, and `scripts/check-arbitrary-font-sizes.mjs`.

## 4. Component inventory

Classification is by folder, then adjusted for `components/ui` files that are product widgets (`StatusBadge`, `ItemAutocomplete`, scanners, HSN lookup, phone input). A file under `components/modals/` or `components/filters/` is labeled shared-business because of where it sits. Several of those files have no importers, so the label means “placed in a shared folder,” not “used widely.”

| Kind | Files | 0 consumers | 1 consumer | 2–5 | More than 5 |
|---|---:|---:|---:|---:|---:|
| UI primitives (`components/ui`, excluding the business widgets above) | 18 | 3 | 3 | 4 | 8 |
| Shared business (layout, navigation, tables, filters, common, plus the UI widgets above) | 54 | 7 | 22 | 13 | 12 |
| Feature components | 456 | 19 | 290 | 122 | 25 |
| Page-local `.tsx` under `app/` that is not a route file | 18 | 0 | 16 | 0 | 2 |
| `lib/**/*.tsx` | 2 | 0 | 0 | 0 | 2 |
| **All component files** | **548** | **29** | **331** | **139** | **49** |

File count and logical-component count are not the same. One file can export several components (`components/reports/RegisterReportUi.tsx` exports `SummaryCards`, `ReportTable`, `StatusBadge`, and `exportCsv`). The export-name pass found 13 names defined in more than one file. It missed annotated `const` exports, so 13 is a lower bound on name collisions, not a catalog of every duplicate.

Largest feature folders by component file count: WhatsApp 64, marketing 54, settings 34, invoices 34, store 34, HR 26, AI agent 20, dashboard 18, admin 16. Those should stay feature-local.

### Most reused modules

| File | Consumers | Of which are pages | Variants |
|---|---:|---:|---|
| `components/ui/Button.tsx` | 358 | 196 | `variant`, `size`, `isLoading` |
| `components/ui/Card.tsx` | 239 | 170 | padding via props; no `variant` field |
| `components/ui/Input.tsx` | 186 | 120 | `label`, `error`, `helperText`, `icon` |
| `components/layout/PageHeader.tsx` | 87 | 83 | title, subtitle, actions |
| `components/common/AccessDenied.tsx` | 65 | 59 | — |
| `components/settings/SettingsPageShell.tsx` | 54 | 53 | settings-only shell |
| `components/layout/MobileDuplicatePageChrome.tsx` | 47 | 46 | — |
| `components/layout/ListPageHeader.tsx` | 33 | 32 | wraps `PageHeader` |
| `components/ui/Toast.tsx` | 32 | 17 | — |
| `components/ui/Chip.tsx` | 21 | 16 | `variant` |
| `components/ui/Textarea.tsx` | 17 | 2 | — |
| `components/ui/Switch.tsx` | 14 | 2 | `size` |
| `components/ui/StatusBadge.tsx` | 12 | 5 | `status`, `showIcon` |
| `components/invoices/ScaledA4Preview.tsx` | 12 | — | invoice preview |

`Button` is the design-system entry point. Inside the business app, 187 of 287 pages import it, and 122 of those pages also contain at least one raw `<button>`.

### Design-system reach

A page “uses the design system” here if it imports `components/ui/*` or `components/layout/*`. That is an import check, not a visual audit.

| Surface | Pages | Import the kit | Independent styling |
|---|---:|---:|---:|
| All pages | 365 | 231 | 41 |
| `app/(app)` only | 287 | 221 | 9 |

“Independent styling” means at least 12 `className` attributes and no import from `components/ui` or `components/layout`. Inside the business shell those nine pages are:

- `app/(app)/invoices/mock/page.tsx`
- `app/(app)/orders/page.tsx`
- `app/(app)/reports/label-print-log/page.tsx`
- `app/(app)/settings/backup/page.tsx`
- `app/(app)/settings/branches/page.tsx`
- `app/(app)/settings/period-locks/page.tsx`
- `app/(app)/settings/user-branches/page.tsx`
- `app/(app)/settings/user-warehouses/page.tsx`
- `app/(app)/settings/warehouses/page.tsx`

Admin, partners, the public store, and a few token pages account for the rest of the 41. Separate chrome there is appropriate.

### Shared files with zero importers

These are exported and unused by the scanned graph. **Verified** as zero imports, not verified as safe to delete (a string reference or a planned screen could still exist).

- `components/ui/DatePicker.tsx` (230 lines)
- `components/ui/Typography.tsx`
- `components/ui/FormPageScaffold.tsx`
- `components/tables/BulkActions.tsx`, `BulkActionsBar.tsx`, `SelectableTableRow.tsx`
- `components/filters/AdvancedFilters.tsx`
- `components/notifications/NotificationPanel.tsx`
- `components/system/StaleDataBanner.tsx`
- `components/layout/AppShellRecovery.tsx`
- `components/dashboard/DashboardCharts.tsx` and `SalesSummaryStats.tsx` (the live dashboard imports `DashboardChartsSection` instead)
- Several invoice debug stubs of 3–8 lines, plus `ExtractionReviewModal.tsx` (881 lines)

## 5. Duplicates that were checked, not just named

Same export name in two files is not automatically a duplicate. These were opened.

### Invoice mock versus the production composer

**Verified name collision and separate implementations.** `app/(app)/invoices/mock/page.tsx` renders `ItemsTable`, `ItemPickerModal`, `TotalsPanel`, `BillToPanel`, and `ShipToPanel` from `app/(app)/invoices/mock/_components/`. The production composer defines the same names in `components/invoices/composer/`. The mock page imports its own `_components` and a local `CATALOG`. It does not import the composer. Treat the mock as a sandbox that still occupies a real route, not as the billing screen.

### `Switch`

**Verified: similar control, different components. Keep both unless the composer is restyled on purpose.**

`components/ui/Switch.tsx` supports `size`, `label`, and `description`, and has 14 consumers. `components/invoices/composer/ui.tsx` defines another `Switch` (a 36×20 button) plus `inputCls`, `Field`, `Kbd`, and `SectionLabel`. The composer is a local visual system for the invoice editor. `app/admin/sales-flow/_components/shared.tsx` and `components/store/admin/theme-studio/studio-ui.tsx` also export a `Field`. Those three `Field`s are small label wrappers in three products. Merging them would not remove a real burden.

### `DocumentViewer`

**Verified: different jobs, same name.**

`components/documents/DocumentViewer.tsx` is a full-screen preview for an uploaded business file (`file_url`, image or PDF, download through `downloadDocument`). `components/whatsapp/conversations/DocumentViewer.tsx` is an in-chat attachment card that fetches `content-length` and opens its own preview. They should not be one component.

### `ProfileSection`

**Verified by path only.** `components/ai-agent/ProfileSection.tsx` and `components/settings/business-profile/ProfileSection.tsx` share a name. They belong to different features. Behavior was not compared line by line. **Inferred:** leave them local.

### `StatusBadge`

**Verified: overlapping idea, different behavior.**

The shared badge maps document statuses (`draft`, `final`, `paid`, `unpaid`, `partially_paid`, `cancelled`, and others) and is used by invoices, purchases, sales orders, and detail panels.

`components/reports/RegisterReportUi.tsx` exports another `StatusBadge` that combines document status with `paymentStatus` and uses a simpler pill (green paid, yellow partial, red otherwise). Local functions also exist in `components/candidate-portal/CandidateTasksTable.tsx` and `components/ai-agent/KnowledgeSection.tsx`. The candidate and knowledge badges are feature statuses. The register badge is the one that overlaps the shared invoice badge.

### Money formatting

**Verified identical copies** in six panels. Each file contains:

```ts
function formatINR(n: number | string | null | undefined) {
  const num = Number(n ?? 0);
  return `₹ ${num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
```

Files:

- `components/invoices/InvoiceDetailPanel.tsx`
- `components/customers/CustomerDetailPanel.tsx`
- `components/purchases/PurchaseDetailPanel.tsx`
- `components/suppliers/SupplierDetailPanel.tsx`
- `components/payments/PaymentDetailPanel.tsx`
- `components/items/ItemDetailPanel.tsx`

The scan also found 16 `function formatInr`, 6 `function formatINR`, and 3 `function formatMoney` definitions, and 646 `toLocaleString('en-IN')` calls in 224 files. Shared helpers that do exist are narrower: `lib/quantity-display.ts` (`formatStockQuantity`, 5 importers) and `lib/insights/format.ts` (`inr`, chat insights). `components/reports/RegisterReportUi.tsx` has yet another `inr` that wraps negatives in parentheses. There is no single UI currency function.

Those six panels also repeat the same screen shape: `useAuth`, a loading flag, an overview tab, and a history fetch. **Inferred** from the two panels that were read in full enough to see that structure (`InvoiceDetailPanel`, `CustomerDetailPanel`) and from the shared formatter in all six. The entities differ, so the panels should not become one component. The formatter should.

## 6. Pattern notes

### Buttons and action menus

`Button` is the shared control (`variant`: primary, accent, secondary, ghost, default, outline, destructive; `size`: sm, md, lg). Classes resolve to `.button-primary` and siblings in `app/globals.css`. Raw `<button>` remains common, including inside shared components (the composer switch, mobile list headers, icon controls). That is acceptable for icon-only and switch controls. It is a problem when a page builds a primary action with its own classes, which the existing `check:ui-primary` script is already aimed at.

### Inputs, selects, dates, forms

`Input` and `Textarea` exist and are used. Native `<select>` appears in 232 files. `components/ui/DatePicker.tsx` wraps `react-day-picker` and has **zero** importers. `DateTimePicker` has one. Native `type="date"` is spread across document forms, reports, HR, and the invoice composer (the new-invoice page alone has many date inputs). **Inferred:** native date inputs are the de facto control, and `DatePicker` is leftover. Forcing the unused picker onto every form would fight the mobile keyboard. The useful action is to pick one approach and stop maintaining the other.

`FormPageScaffold.tsx` and `Typography.tsx` have zero consumers. `FormSection` has one. Pages rely on `globals.css` type classes and on `PageHeader`, which matches the typography check script better than the unused `Typography` component does.

Zod is imported by 9 files. Form validation is not a shared form library. **Inferred** from that import count: most forms validate inline.

### Tables, pagination, filtering, sorting

There is no shared data table. `components/tables/*` (`BulkActions`, `BulkActionsBar`, `SelectableTableRow`, and `ColumnSelector`) is the intended kit; the first three have zero consumers. Reports use `ReportTable` inside `components/reports/RegisterReportUi.tsx`. Invoice lines use `components/invoices/composer/ComposerItemsTable.tsx`. `hooks/useTableColumns.ts` exists for column choice. Pagination and sort UI were not found as a shared component. **Inferred:** each list page implements its own table. That is reasonable. Building one generic grid for invoices, GST reconciliation, and HR would be worse than the current split.

`components/filters/AdvancedFilters.tsx` has zero consumers. Search UI is not a shared search bar. `components/search` is a single feature file. List search boxes are local.

### Dialogs, drawers, sheets

`components/ui/SlideOverPanel.tsx` has 3 consumers (purchase-order detail and the AI agent were confirmed). `components/modals/ReasonConfirmModal.tsx` is an accounting confirm: it requires a reason and renders `AccountingErrorView`. `components/common/DeleteAction.tsx` is a delete/deactivate confirm with a toast. `components/whatsapp/ConfirmDialog.tsx` is a WhatsApp yes/no dialog and is used by WhatsApp screens. `window.confirm` appears in 29 files (40 calls), including POS clear-bill, delivery challans, and marketing publish.

These are not one dialog copied four times. `window.confirm` is the part worth replacing with a small shared confirm, and only where the message is a simple yes/no. Leave `ReasonConfirmModal` and `DeleteAction` as they are.

Radix dialog is installed and unused in application source.

### Status, headers, empty and loading states

Headers are in good shape: `PageHeader`, `ListPageHeader` (list pages whose mobile “+” lives in the top bar), `MobileDuplicatePageChrome`, and `SettingsPageHeader` / `SettingsPageShell`. Breadcrumbs were not found as a shared component. **Unverified** whether any page draws its own breadcrumb trail.

Empty copy is inline. The scan matched “No … yet” in 118 files (131 hits). `animate-pulse` appears in 24 files. There is no `EmptyState` or `Skeleton` component. That duplication is mostly sentence-level. A shared empty component would only pay off for list pages that repeat the same layout, not for every sentence.

### Search, currency, quantity, dates, submit behavior

Covered above. Quantity display for packs is already shared (`lib/quantity-display.ts`) and is the pattern money formatting should follow. Submit behavior is per screen: `useEntityMutation` exists, and most composers call `fetch` themselves. Detail panels do that inside the component (`InvoiceDetailPanel` fetches `/api/invoices/${id}` in the same file as the tabs). That mixes data access and presentation. It is consistent across those panels and acceptable at this size. It becomes costly if every new document copies the whole panel.

## 7. Architectural quality

The layers are the right ones:

| Layer | What it is today | Keep it? |
|---|---|---|
| Design system | `components/ui/Button`, `Input`, `Card`, `Textarea`, `Chip`, `Switch`, plus `app/globals.css` | Yes. This is the part that should stay mandatory for business-app pages. |
| Shared business chrome | `PageHeader`, `ListPageHeader`, `AppLayout`, `AccessDenied`, `StatusBadge`, `DeleteAction` | Yes. |
| Feature components | 456 files, most with one consumer | Yes. A WhatsApp modal or an HR panel should not move to `components/ui`. |
| Page composition | `app/(app)/**/page.tsx` assembling those pieces | Yes. 221 of 287 business pages already import the kit. |
| Data access | `hooks/useEntityList` and friends, plus `fetch` inside feature components | The hooks are the right seam. They are lightly used. Do not extract a global data layer as part of a UI cleanup. |

Shared components are used consistently for buttons, cards, inputs, and page titles. They are not used consistently for status pills, money, confirms, dates, or tables. Unused shared files (`DatePicker`, `Typography`, `FormPageScaffold`, `components/tables/*`, `AdvancedFilters`) make the kit look larger than it is. New work can miss the live components and copy a page instead.

Do not centralize marketing, storefront, admin, partner, or WhatsApp UI into the billing kit. Those surfaces already have their own layouts.

## 8. High-value reuse work, in order

1. **Add one UI money helper and use it in the six detail panels.** The function body is already identical. Put it next to `lib/quantity-display.ts` or in a small `lib/format-money.ts`. Leave report parentheses-style `inr` and insight `inr` alone until someone is changing those screens. Low risk.
2. **Point register reports at `components/ui/StatusBadge` only if the payment-status colors are supposed to match invoices.** Today they do not match. Decide the visual, then delete the local function in `RegisterReportUi.tsx`. Do not fold candidate-task or knowledge-base badges into it.
3. **Replace simple `window.confirm` calls with one yes/no dialog** that uses `Button`. Do not merge it with `ReasonConfirmModal` or `DeleteAction`.
4. **Either wire `DatePicker` into the document forms or remove it.** Native `type="date"` is already the pattern. Maintaining a 230-line unused picker plus dozens of native inputs is the burden.
5. **Delete or quarantine `app/(app)/invoices/mock`** if the composer in `components/invoices/composer` is the product. As long as both exist, every composer change has a shadow copy with the same component names.
6. **Remove or adopt the unused table and filter components** (`components/tables/BulkActions*.tsx`, `SelectableTableRow.tsx`, `AdvancedFilters.tsx`). A third table implementation is more likely while these sit unused beside `ReportTable`.
7. **Pick one toast for new business-app code.** `react-hot-toast` (13 files, including `DeleteAction` and `useEntityList`), `components/ui/Toast.tsx` (32), and `EnhancedToast` / `ToastContainer` are all live. New screens should not add a fourth.
8. **Leave feature folders local.** WhatsApp, marketing, HR, and the invoice composer’s `ui.tsx` are allowed to have their own controls.

## 9. React and Flutter as two frontends

**Verified from `phone/lib`.** The Flutter app is a separate client. It reimplements login, the app shell, and the dashboard. It calls the same HTTP API. It does not import React components. Colors and the portal theme were copied into `phone/lib/theme.dart`. Widgets such as `WebCard`, `WebButton`, and `WebInput` live in `phone/lib/ui/web_ui.dart`. Dashboard cards, charts, and the recent-transaction search restyle themselves in Dart even when a React component already exists.

**Effort.** Every business screen that must look like the website has to be built again: layout, states, and formatting. The React app has 365 route patterns. The phone app has two finished screens. Catching the phone up by copying pages is a multi-year surface area if the goal is parity.

**Risks.**

- A change to `.button-primary` or `StatusBadge` does not change the phone app.
- Money formatting already diverges inside React. A third copy in Dart (`phone/lib/format.dart`) will drift again.
- The phone dashboard paints charts by scaling an 800-wide canvas copied from the website SVG. React chart edits will not carry over.
- Silent failures differ. Several React panels show their own errors. The phone overview turns a failed load into zeros.

**Strategy.** Share contracts, not components.

- Keep one status vocabulary (`draft`, `paid`, `partially_paid`, and the rest of `StatusBadge`) and one money rule on the server or in a spec the phone and the web both follow.
- Build Flutter with Flutter widgets. Stop mirroring each React file.
- Port a screen only when that phone workflow is in scope. Do not generate Dart from JSX.
- When a token changes (primary color, radius, type scale), update `app/globals.css` and `phone/lib/theme.dart` together. That is the only realistic shared layer.

## 10. Label summary

| Claim | Label |
|---|---|
| Page, route, layout, API, and import counts | Verified by `generate-frontend-reuse-inventory.mjs` |
| Button, Card, Input, PageHeader usage | Verified |
| Six identical `formatINR` functions | Verified |
| `DatePicker`, `Typography`, `FormPageScaffold`, table bulk actions, `AdvancedFilters` have no scanned importers | Verified |
| Radix dialog/dropdown/select/toast have no source imports; tabs are used twice | Verified |
| Mock invoice route does not use the production composer | Verified |
| Two `DocumentViewer`s do different jobs | Verified |
| Register `StatusBadge` differs from `components/ui/StatusBadge` | Verified |
| Detail panels share a tab-and-history structure beyond the formatter | Inferred from two panels plus the common helper |
| `ProfileSection` pairs should stay separate | Inferred |
| Native date inputs are an intentional mobile choice | Inferred |
| No shared breadcrumb component is a product gap | Unverified |
| Unused files are dead code safe to delete | Unverified |
