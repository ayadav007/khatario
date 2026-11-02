# Unified upgrade popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One consistent, apologetic, Khatario-branded upgrade popup (five versions) on the website and in the Android app, opened automatically whenever the server says "not in your plan" or "limit reached", replacing the five different upgrade designs we have today.

**Architecture:** Pure helpers in `lib/upgrade/` turn a server reply (or a caller's request) into an `UpgradeRequest` and then into display copy. One web dialog (`components/subscription/upgrade/`) renders that copy with the illustrated header; the existing `FeatureUpgradeModalProvider` becomes the single owner of the dialog and also watches `fetch` for plan and limit replies on write requests. The old components keep their props but render the new dialog. The phone app ports the same copy helper to Dart and shows a matching bottom sheet from a hook in `KhatarioApi`.

**Tech Stack:** Next.js 14 app router, React, Tailwind, Jest (node env), Flutter 3 + Dio, `flutter_svg`.

**Spec:** this chat (2026-11-01/02), summarised in "Design" below. Mockups: header band with dashed orange orbit, two white chips with orange icon tiles, main object with dark green badge; body = tag, "Sorry, …" title, one sentence, detail box, recommended plan row, orange button, trust line, soft way out.

## Design (from the agreed mockups)

| Variant | Tag | Title pattern | Detail box | Way out | Closable |
|---|---|---|---|---|---|
| `feature` | Not in your plan | `Sorry, {Feature} isn't in your plan` | 3 benefits of the recommended plan (fallback: plan description) | Maybe later | yes |
| `limit` | Limit reached | `Sorry, you've used all {limit} {noun} {period}` · users: `Sorry, your plan has room for {limit} user(s)` | usage bar `{current} of {limit} used` + `{Plan} gives you {planLimit or "unlimited"} {noun}` | Maybe later | yes |
| `addon` | Add-on | `Sorry, {Feature} needs Khatario Connect` | 3 Connect benefits | Maybe later | yes |
| `trial` | Trial | `Your free trial ends in {n} days` / `…ends today` / `Your free trial has ended` | 14-segment day bar + end date | Remind me tomorrow | yes |
| `web` | Phone-only plan | `Sorry, Khatario Free doesn't open on a computer` | QR to the Android app + "Sign in with {masked phone}" | Sign out | **no** |

Body sentence always ends with reassurance (`Everything you've made stays as it is.` / `Your data stays safe.`).

## Global Constraints

- Colours: orange `#F58220` (accent-500), green `#032B23` (primary), cream band `#F8F3E9`, peach `#feecde` (accent-100), light orange `#fcd7b8` (accent-200), body text `#5c5247`, muted `#8a7b6b`. Use Tailwind `accent-*`/`primary-*` where they exist.
- Copy: sentence case, plain feature names (no "Template Customization"), no "!", every denial title starts with `Sorry,` except `trial`.
- Primary button labels: `Upgrade to {Plan}`, `Add Khatario Connect`, `Choose a plan`.
- Trust line under the button: `Secure UPI or card · works right after payment` (web only; phone has no checkout yet).
- "Maybe later" snoozes the same request key until the end of the local day (localStorage on web, in-memory on phone).
- The interceptor only reacts to `POST`/`PUT`/`PATCH`/`DELETE` to same-origin `/api/` URLs. GET denials stay with page guards.
- Never trust client `business_id`; no new server routes take it from the client.
- Android app link: `process.env.NEXT_PUBLIC_ANDROID_APP_URL ?? 'https://play.google.com/store/apps/details?id=com.khatario.phone'`.

## Review Focus

1. A page that already opens its own upgrade modal on a limit reply must not show two dialogs → interceptor defers 250 ms and skips when a dialog is mounted (Task 3 test).
2. A Free user inside the phone app's web view must never see the web wall → `shouldBlockWeb({ allowed:false, inPhoneApp:true })` is false (Task 6 test).
3. A plan or limit reply on a background GET (usage strip, `check-limit`, document-language probe) must not pop a dialog → `upgradeRequestFromResponse` returns null for GET (Task 1 test).
4. Unknown feature key or missing plan data must still render a sensible dialog → copy falls back to `This feature` and the `Compare plans` view (Task 2 test).
5. A limit reply without `limit_type` (older route) must still open the `limit` variant with generic noun `items`→ falls back to `limit` copy `Sorry, you've reached your plan's limit` (Task 1 + 2 tests).

---

### Task 1: Upgrade request model and reply parser

**Files:**
- Create: `lib/upgrade/upgrade-request.ts`
- Test: `tests/lib/upgrade-request.test.ts`

**Interfaces:**
- Produces:
  - `type UpgradeVariant = 'feature' | 'limit' | 'addon' | 'trial' | 'web'`
  - `interface UpgradeRequest { variant: UpgradeVariant; featureKey?: string; featureName?: string; limitType?: string; current?: number; limit?: number; moduleKey?: PlatformModule; initialPlanId?: string; trialDaysLeft?: number; trialEndsOn?: string; showTrialOption?: boolean }`
  - `upgradeRequestFromResponse(method: string, status: number, body: Record<string, unknown> | null): UpgradeRequest | null`
  - `upgradeRequestKey(req: UpgradeRequest): string` → `${variant}:${featureKey ?? limitType ?? ''}`
  - `const ADDON_FEATURE_KEYS: ReadonlySet<string>` = `integration_whatsapp_bot`, `integration_whatsapp_manual`, `whatsapp_bot`, `whatsapp_send_message`

- [ ] **Step 1: Write failing tests**: `POST 403 {code:'FEATURE_NOT_IN_PLAN', feature:'eway_bill'}` → `{variant:'feature', featureKey:'eway_bill'}`; legacy `FEATURE_NOT_AVAILABLE` same; `feature:'integration_whatsapp_bot'` → `variant:'addon', moduleKey:'connect', initialPlanId:'connect'`; `POST 403 {code:'SUBSCRIPTION_LIMIT_EXCEEDED', limit_type:'estimates', limit:20, current:20}` → `variant:'limit'` with those numbers; same without `limit_type` → `variant:'limit'`, `limitType` undefined; `GET` with either code → `null`; `POST 400` → `null`; `POST 403 {code:'PERMISSION_DENIED'}` → `null`.
- [ ] **Step 2:** `npx jest tests/lib/upgrade-request.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement. Method compare is case-insensitive.
- [ ] **Step 4:** Same command → PASS.

### Task 2: Copy builder

**Files:**
- Create: `lib/upgrade/upgrade-copy.ts`
- Modify: `lib/feature-upgrade-labels.ts` (sentence-case labels; add `eway_bill: 'E-way bills'`, `integration_email: 'Email invoices'`, `profit_reports_basic: 'Profit by invoice'`, `report_builder: 'Custom reports'`, `settings_multi_business: 'More than one business'`, `multi_business`, `advanced_multi_currency: 'Foreign currency bills'`, `multi_currency`, `settings_multi_warehouse: 'Warehouses'`, `multi_warehouse`, `settings_template_customization: 'Template customisation'`; fix `Estimates & quotations` → `Estimates and quotations`, `Backup & restore` → `Backup and restore`, `Scan & Add Items` → `Scan and add items`)
- Test: `tests/lib/upgrade-copy.test.ts`

**Interfaces:**
- Consumes: `UpgradeRequest` (Task 1), `getFeatureDisplayName` from `lib/feature-upgrade-labels.ts`.
- Produces:
  - `interface RecommendedPlan { planId: string; planLabel: string; priceMonthly: number; planLimit?: number }`
  - `type UpgradeArtObject = 'bill' | 'users' | 'chat' | 'cal' | 'laptop'`, `type UpgradeBadge = 'lock' | 'full' | 'plus' | 'clock'`, `type UpgradeIcon = 'chart' | 'rupee' | 'users' | 'lock' | 'chat' | 'bolt' | 'clock' | 'check' | 'phone' | 'box'`
  - `interface UpgradeChip { icon: UpgradeIcon; title: string; subtitle: string }`
  - `interface UpgradeCopy { tag: string; title: string; body: string; object: UpgradeArtObject; badge: UpgradeBadge; chips: [UpgradeChip, UpgradeChip]; tiles: [UpgradeIcon, UpgradeIcon]; ctaLabel: string; laterLabel: string; closable: boolean }`
  - `buildUpgradeCopy(req: UpgradeRequest, plan: RecommendedPlan | null): UpgradeCopy`
  - `LIMIT_NOUNS: Record<string, { noun: string; period: 'month' | 'day' | null }>` covering every `LimitCheckType` in `lib/subscription/limit-registry.ts` (e.g. `invoices: {noun:'invoices', period:'month'}`, `whatsapp: {noun:'WhatsApp messages', period:'day'}`, `email: {noun:'emails', period:'day'}`, `suppliers: {noun:'suppliers', period:null}`).

- [ ] **Step 1: Write failing tests** (exact strings):
  - feature `profit_reports_basic`, plan Growth → title `Sorry, Profit by invoice isn't in your plan`, cta `Upgrade to Growth`, tag `Not in your plan`, closable true, object `bill`, badge `lock`.
  - feature unknown key `xyz`, plan null → title `Sorry, this feature isn't in your plan`, cta `See plans`.
  - limit `estimates` 20/20, plan Starter (planLimit -1) → title `Sorry, you've used all 20 estimates this month`, chips[0].subtitle `Unlimited on Starter`.
  - limit `users` 1/1 → title `Sorry, your plan has room for 1 user`; limit `users` 3 → `… for 3 users`; object `users`, badge `full`.
  - limit without limitType → title `Sorry, you've reached your plan's limit`.
  - addon → title `Sorry, WhatsApp inbox needs Khatario Connect`, cta `Add Khatario Connect`, object `chat`, badge `plus`.
  - trial 3 days → `Your free trial ends in 3 days`; 1 → `… in 1 day`; 0 → `Your free trial ends today`; -1 → `Your free trial has ended`; laterLabel `Remind me tomorrow`.
  - web → title `Sorry, Khatario Free doesn't open on a computer`, closable false, laterLabel `Sign out`, object `laptop`.
  - every variant's `body` ends with `.` and contains `stays`.
- [ ] **Step 2:** `npx jest tests/lib/upgrade-copy.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Chips per variant follow the mockup (`feature`: chart "{Feature}" / rupee "With {Plan}"; `limit`: users/lock "{current} of {limit} used"; `addon`: chat "Shared inbox" / bolt "Auto replies"; `trial`: clock "{n} days left" / check "Data stays safe"; `web`: phone "Android app · Free forever" / lock "This computer · Needs a plan").
- [ ] **Step 4:** PASS.

### Task 3: Snooze + interceptor core

**Files:**
- Create: `lib/upgrade/upgrade-snooze.ts`, `lib/upgrade/upgrade-fetch-watch.ts`
- Test: `tests/lib/upgrade-fetch-watch.test.ts`

**Interfaces:**
- Produces:
  - `isUpgradeSnoozed(key: string, now: Date, store: Pick<Storage,'getItem'>): boolean`, `snoozeUpgrade(key: string, now: Date, store: Pick<Storage,'setItem'>): void` (stores local date `YYYY-MM-DD` under `kh-upgrade-snooze:{key}`).
  - `installUpgradeFetchWatch(opts: { open(req: UpgradeRequest): void; isDialogOpen(): boolean; delayMs?: number }): () => void` — wraps `window.fetch`, returns uninstall. Only same-origin paths starting `/api/`; only status 403; reads `response.clone().json()`; after `delayMs` (default 250) calls `open` unless `isDialogOpen()`.
  - `markUpgradeDialogMounted(): () => void` and `isAnyUpgradeDialogMounted(): boolean` (module counter used by every dialog instance).

- [ ] **Step 1: Write failing tests** with a fake `window.fetch` and jest fake timers: POST 403 limit reply → `open` called once after 250 ms; same while `isDialogOpen()` true → not called; GET 403 → not called; cross-origin URL → not called; original response body still readable by caller; snooze: snoozed today → true, yesterday's value → false.
- [ ] **Step 2–4:** run `npx jest tests/lib/upgrade-fetch-watch.test.ts` fail → implement → pass.

### Task 4: Recommended plan for every limit

**Files:**
- Modify: `lib/subscription/limit-plan-recommendation.ts` (accept every `LimitCheckType`; filter candidate plans to `product_line = productLineForModule(getLimitOwnerModule(limitType) ?? 'billing')`, treating null `product_line` as `billing`)
- Modify: `app/api/subscriptions/limit-plan/route.ts` (accept any `LimitCheckType`)
- Test: `tests/db/limit-plan-recommendation.db.test.ts` (DB `kh_phase2_test` only)

- [ ] **Step 1:** Test: `getLowestPlanForLimit('estimates', 20)` returns a billing-line plan; `getLowestPlanForLimit('employees', 5)` returns an `hr_*` plan; `'users', 0` on Free returns `billing_starter`.
- [ ] **Step 2–4:** `npx jest tests/db/limit-plan-recommendation.db.test.ts` fail → implement → pass.

### Task 5: Web dialog, illustration and plan picker

**Files:**
- Create: `components/subscription/upgrade/UpgradeIllustration.tsx` (`UpgradeIllustration({ copy }: { copy: UpgradeCopy })`, SVG from the approved mockup, 380×158 viewBox, `role="img"`)
- Create: `components/subscription/upgrade/UpgradePlanPicker.tsx` — the plan grid, billing cycle, coupon, trial-module card and `startPlanUpgrade` logic moved from `UpgradeModal.tsx`, restyled to brand cards (`border-accent-500` selected, cream background). Props: `{ moduleKey?: PlatformModule; initialPlanId?: string; showTrialOption?: boolean; onBack?(): void; onClose(): void; onUpgradeSuccess?(): void }`.
- Create: `components/subscription/upgrade/UpgradeDialog.tsx` — `UpgradeDialog({ request, onClose, onUpgradeSuccess, onSignOut }: { request: UpgradeRequest; onClose(): void; onUpgradeSuccess?(): void; onSignOut?(): void })`. Loads the recommended plan (`/api/subscriptions/feature-plan?feature_key=` for feature/addon, `/api/subscriptions/limit-plan?business_id=&limit_type=&current=` for limit, cheapest public billing plan for trial/web from `/api/subscriptions/plans`). Two steps: `summary` (the mockup) → `plans` (`UpgradePlanPicker`, preselected `plan.planId`). CTA and `Compare plans` both go to `plans`. Calls `markUpgradeDialogMounted()` while mounted. Escape/backdrop close only when `copy.closable`. `Maybe later`/`Remind me tomorrow` call `snoozeUpgrade` then `onClose`. `web` variant renders the QR (`qrcode.react` `QRCodeSVG`, value = Android app link) in the detail box.
- Create: `components/subscription/upgrade/UpgradeLockedPanel.tsx` — same parts inline (no overlay) for full-page denials: `UpgradeLockedPanel({ request }: { request: UpgradeRequest })`; its CTA opens the dialog at the `plans` step.

- [ ] **Step 1:** `npx tsc --noEmit -p tsconfig.json` passes for the new files.
- [ ] **Step 2:** Staging test steps written into the project log entry (see Task 9) — memory rule: no slow local browser checks.

### Task 6: Provider, interceptor and old components moved onto the dialog

**Files:**
- Modify: `contexts/FeatureUpgradeModalContext.tsx` — keep `openForPlanDenied`, `openIfFeatureDeniedResponse` (now also limit replies), `dismiss`; add `openUpgrade(req: UpgradeRequest): void`; render `UpgradeDialog`; install `installUpgradeFetchWatch` on mount with `isDialogOpen: isAnyUpgradeDialogMounted`; skip when `isUpgradeSnoozed`.
- Modify: `components/subscription/UpgradeModal.tsx` → thin wrapper mapping its props to an `UpgradeRequest` (`limitType==='feature'` → feature; others → limit; `showTrialOption` → dialog opens at `plans` step) and rendering `UpgradeDialog`.
- Modify: `components/subscription/UpgradePrompt.tsx` → thin wrapper, same props.
- Modify: `components/subscription/WhatsAppAddonModal.tsx` → `UpgradeDialog` with `{variant:'addon', moduleKey:'connect', initialPlanId:'connect'}`.
- Modify: `components/subscription/PlanFeatureDeniedCallout.tsx` → brand inline card (cream, orange button `See plans`, `Sorry,` headline).
- Modify: `components/common/AccessDenied.tsx` → when `code === 'FEATURE_NOT_IN_PLAN'` render `UpgradeLockedPanel` (`featureKey` from new optional `feature` prop).
- Modify: `components/subscription/SubscriptionBanner.tsx` → trial/grace CTA calls `openUpgrade({variant:'trial', trialDaysLeft, trialEndsOn})` instead of linking.
- Modify: `components/layout/WebAccessGate.tsx` → export `shouldBlockWeb({ allowed, inPhoneApp, pathname }): boolean`; skip inside the phone app (`isInsidePhoneApp()`); render `UpgradeDialog` with `{variant:'web'}` full-screen, `onSignOut` = auth logout.
- Test: `tests/lib/web-access-gate.test.ts` — `shouldBlockWeb({allowed:false,inPhoneApp:true,pathname:'/dashboard'})` false; `{allowed:false,inPhoneApp:false,'/dashboard'}` true; `'/settings/subscription'` false; `allowed:null` false.

- [ ] Steps: failing gate test → implement → `npx jest tests/lib/web-access-gate.test.ts tests/lib/upgrade-*.test.ts` pass → `npx tsc --noEmit` pass.

### Task 7: Server gaps

**Files:**
- Modify: `lib/subscription/plan-path-gate.ts` — add before `/reports`: `{ prefix: '/reports/profit-by-invoice', featureId: 'profit_reports_basic' }`, `{ prefix: '/reports/builder', featureId: 'report_builder' }`; add `{ prefix: '/items/barcodes', featureId: 'barcode_label_printing' }`, `{ prefix: '/settings/label-templates', featureId: 'barcode_label_templates' }`.
- Modify: `lib/enforce-access.ts`, `lib/subscription/limit-response.ts`, `app/api/settings/users/route.ts`, `app/api/settings/users/[id]/route.ts`, `app/api/items/import/route.ts`, `app/api/items/bundle/route.ts` — every `SUBSCRIPTION_LIMIT_EXCEEDED` body gains `limit_type`.
- Modify: `app/api/whatsapp/send-bulk-reminders/route.ts`, `app/api/customers/[id]/send-reminder/route.ts` — `LIMIT_EXCEEDED` → `SUBSCRIPTION_LIMIT_EXCEEDED`, `limit_type:'whatsapp'`, status 403 (the 500 becomes 403); update client checks of `'LIMIT_EXCEEDED'` (`components/whatsapp/SendRemindersTab.tsx`).
- Modify: `lib/business-email.ts` — return `{ success:false, error, code:'SUBSCRIPTION_LIMIT_EXCEEDED' }` on the email limit; the email routes that call it (`app/api/invoices/[id]/email`, `app/api/documents/[table]/[id]/email`) reply 403 with `code` + `limit_type:'email'` when `code` is set.
- Test: `tests/lib/plan-path-gate.test.ts` — `featureIdForPath('/reports/profit-by-invoice')` = `profit_reports_basic`, `'/reports/builder'` = `report_builder`, `'/items/barcodes'` = `barcode_label_printing`, `'/reports/sales'` still `reports_basic`.
- [ ] Steps: failing test → implement → `npx jest tests/lib/plan-path-gate.test.ts` pass → `npx tsc --noEmit` pass.

### Task 8: Phone app sheet and handler

**Files:**
- Modify: `phone/pubspec.yaml` — add `flutter_svg`.
- Modify: `phone/lib/api.dart` — `ApiException` gains `final Map<String, dynamic> body;` (default `{}`); `_fail` receives the body and the HTTP method; new `void Function(ApiException error)? onUpgradeNeeded;` fired for `POST/PUT/PATCH/DELETE` when `code` is `FEATURE_NOT_IN_PLAN`, `FEATURE_NOT_AVAILABLE` or `SUBSCRIPTION_LIMIT_EXCEEDED`.
- Create: `phone/lib/upgrade/upgrade_copy.dart` — Dart port of Task 1+2 (`UpgradeRequest.fromException(ApiException)`, `buildUpgradeCopy(UpgradeRequest, RecommendedPlan?)`), same strings.
- Create: `phone/lib/upgrade/upgrade_sheet.dart` — `Future<void> showUpgradeSheet(BuildContext context, {required UpgradeRequest request, required KhatarioApi api, required VoidCallback onSeePlans})`; header via `SvgPicture.string` of the same illustration; button `See plans` (no checkout in the phone yet) → `onSeePlans`; `Maybe later` snoozes for the day in memory.
- Modify: `phone/lib/shell/app_shell.dart` — register `api.onUpgradeNeeded` in `initState`, unregister in `dispose`; `onSeePlans` → existing `onOpen('Subscription')`.
- Modify: `phone/lib/shell/shell_banners.dart` — trial banner button opens the sheet with `variant: trial`.
- Test: `phone/test/upgrade_copy_test.dart` — the same string cases as Task 2 (feature, limit users 1, addon, trial 0/3, unknown feature).
- [ ] Steps: failing test → implement → `C:\Users\Abhishek\flutter\bin\flutter.bat test test/upgrade_copy_test.dart` (in `phone/`) pass → `flutter analyze` clean.

### Task 9: Wrap-up

- [ ] `npx jest tests/lib/upgrade-request.test.ts tests/lib/upgrade-copy.test.ts tests/lib/upgrade-fetch-watch.test.ts tests/lib/web-access-gate.test.ts tests/lib/plan-path-gate.test.ts` pass; `npx tsc --noEmit` pass; `flutter test` for the new file pass.
- [ ] `graphify update .`
- [ ] Append to `docs/project.log.md` with staging test steps (Free on web → wall; Free inside phone web view → no wall; Starter opens Profit by invoice → feature dialog; estimate over limit → limit dialog; "Maybe later" not shown again same day; WhatsApp inbox on a non-Connect business → add-on dialog; trial banner → trial dialog).
- [ ] No commit unless asked.

## Not in this plan (decided)

- Server-side refusal of browser API calls for Free: old APKs don't identify themselves, so enforcing would lock out every Free phone user. Needs the app to send `X-Khatario-Client` first and an adoption window.
- Enforcing the unused HR limits (departments, attendance…): plans may hold low values nobody expects to be enforced; needs a product decision.
- Bluetooth printing on Free (`barcode_thermal_printer`): product decision, unchanged.
- "Send link to my WhatsApp" on the web wall: no confirmed platform WhatsApp sender; the QR code ships instead.
