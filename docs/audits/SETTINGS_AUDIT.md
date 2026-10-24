# Settings audit — Khatario (web + phone)

Date: 14 Oct 2026. Scope: every screen reachable from **All settings** (`/settings`), the quick-settings sheets on list pages, settings that live outside the settings area, and what the phone app exposes.
Source of truth checked: `lib/settings-module-registry.ts` (hub and sidebar), every `app/(app)/settings/**/page.tsx` and the components they render, `lib/module-settings.ts`, `components/orders/OrderUpdateSettingsDialog.tsx`, and `phone/lib/screens/settings` and `page_catalog.dart`.

**In numbers:** 77 settings routes. 8 only redirect to another page (invoice, tax, gst-config, signature, export and the three old AI routes), which leaves 69 screens, roughly 600 individual options, in 5 hub bands and 23 columns. Another 6 settings live outside the settings area. The phone app has proper screens for only 1 of them (Appearance); 13 more open as a raw field editor.

---

## 1. Verdict in one paragraph

The **content** of settings is rich and mostly correct (GST, HR, store, WhatsApp, AI agent are all genuinely deep). The **structure** is the problem. Settings are grouped by the internal product the feature belongs to (Billing / People / WhatsApp / Connect) instead of by the job the owner is doing. The same option appears in two or three places, related options are split across far-apart screens, some screens are developer tools, and the save behaviour differs from page to page. A shop owner looking for "where do I set my UPI ID" or "how do deliveries work" has to know Khatario's module map. The phone app has no real settings at all. The fix is a re-grouping into 9 task-based groups with one consistent page pattern (section 4), plus about 20 specific fixes (section 3).

---

## 2. Complete inventory (what exists today, what it is for)

Legend for **Verdict**: ✅ keep as is · ✏️ keep, needs wording/layout fix · 🔀 merge or move · 🧰 not a setting (tool, report or diagnostics) · ⚠️ bug or risky.

### 2.1 Account band

| Screen (route) | Options on it | What it is for | Verdict |
|---|---|---|---|
| **Business profile** (`/settings/business`) | Business name, email, phone | Identity printed on every invoice and message | ✅ |
| | Address line 1/2, city, state, pincode | Invoice header; GST needs it on tax invoices; state decides CGST+SGST vs IGST | ✅ |
| | Registration type (Regular / Composition / Not registered), GSTIN, PAN, "Turnover above ₹5 crore" (6-digit HSN) | Decides tax invoice vs bill of supply, HSN length, what prints in the header | ✅ |
| | PAN (HR-only variant) | Payslips and Form 16 | ✅ |
| | Logo, Signature | Printed on documents | ✅ |
| | Bank accounts (name, bank, account no, IFSC, branch, type, active) | "Where to pay" block on invoices | 🔀 belongs with Payments |
| | UPI and payment methods (type, name, UPI ID, wallet, priority, active, default) | UPI QR on invoices, WhatsApp payment links | 🔀 duplicated on `/settings/payments` |
| | About: business type, industry, sells-to, AI introduction | Report tailoring and context for the WhatsApp AI agent | 🔀 the AI text belongs in AI agent > Profile (it already has "Refill from business profile") |
| | Exporter: IEC, SWIFT | Export invoices | ✅ (collapse by default) |
| | Billing preferences: Product variants, Allow sales when out of stock (default), Warehouses, Give branch staff their branch's warehouse, POS mode | How items, stock and the bill screen behave | 🔀 these are invoicing/stock behaviour, not "profile" |
| | Print language (plan-gated) | Language of printed documents | 🔀 belongs with Templates & printing |
| **Branches** (`/settings/branches`, new, edit) | Name, code, primary, GSTIN, state code, address, phone, email, invoice prefix | Multi-GSTIN / multi-outlet accounting | ✏️ upgrade copy says "Enterprise plan"; plans are now Free/Growth/Business |
| **Financial years** | Label, start, end, notes; "Use current Indian FY" | Periods for reports, closing stock, GST, TDS | ✅ (move to Accounting) |
| **Warehouses** (list, new, edit) | Name, code, address, type (Physical / Virtual / Damaged), active, linked branches, migrate stock | Multi-godown stock | ✏️ "Enterprise Feature" copy is stale |
| **User management** (`/settings/user-management`) | Two buttons: Roles, Manage users | Landing page only | 🔀 remove; it adds a click |
| **Manage users** | Name, phone, email, password, role, branch, multidevice sync, warehouse access, activate/deactivate | Who can sign in | ✏️ |
| **Manage roles** | Role name, description, permission matrix | Role-based access | ⚠️ shows "Please run migration 059_rbac.sql" to customers |
| **User branches** | User, branch, Create transactions / View reports / Manage inventory | Branch access per user | 🔀 into the user's detail screen |
| **User warehouses** | User, warehouse, view/create | Warehouse access per user | 🔀 same (Manage users already has "Manage warehouse access") |
| **Activity logs** | Filter by module and user | Audit trail | 🧰 a report, keep linked from Team |
| **Your products** | Enable Billing / HR / Connect, primary product | Which apps are on | ✅ |
| **Plan & billing** | Plans per product, seats, usage, billing history, coupon, cancel | Subscription | ✅ |

### 2.2 Billing band

| Screen | Options | What it is for | Verdict |
|---|---|---|---|
| **Suppliers directory** | Visibility (Hidden / Link only / Directory), profile summary, categories, URL slug, connection requests, published listings | Be discoverable to other Khatario businesses (B2B marketplace) | ✏️ it's a marketing listing, not billing setup; move to "Online presence" |
| **POS mode** (link to profile anchor) | On/off | Counter-billing screen | 🔀 with invoice-screen preferences |
| **Account mappings** | Sales, receivables, purchases, payables, cash, bank, inventory, COGS, expense accounts; Auto-detect | Which ledger each transaction posts to | ✏️ accountant-only; hide behind "Advanced" with plain-language help |
| **Period locks** | Branch, FY, period start/end, notes; lock/unlock | Stop back-dated edits after filing | ✅ |
| **Templates & printing** | Per document type (9 types): choose template, preview, customize, copy to other types, test print | Invoice/document design | ✅ |
| Customize template (drawer and `/settings/templates/customize`) | Colours, font, size, paper (A4/A5/Letter/Legal), orientation, logo/signature/"Authorised signatory" visibility, ~70 field toggles (business, invoice, customer, item table, totals) | Fine control of the printed page | 🔀 two customizers exist (drawer and full page); keep one |
| **Print & devices** | Regular printer vs Bluetooth thermal, paper/brand, BLE pairing, default printer for labels and receipts | Device printing | ✅ |
| Printer diagnostics | Runtime details | Support tool | 🧰 move under Help |
| **Custom fields** | Item fields and invoice fields: label, type (text/number/date/dropdown), options, required | Extra data on items and bills | ✅ |
| **Transaction number series** | Per branch × document (9 types): prefix, starting number, preview | Invoice numbering | ✅ |
| **Storefront** (`/settings/online-store`), tabs Appearance / Promo / Store setup / Pages | Store URL, live toggle, minimum order, pay on delivery, **return window**, delivery partner, Shiprocket login and webhook token, delivery zones (radius, pincodes, self-pickup, charge tiers), coupons, promo sheet (about 15 options), logo, favicon, banners, sections, collections, fonts, custom CSS, About / Contact / Privacy / Refund / Terms pages | Running the online store | 🔀 store setup (money, delivery, returns) is mixed in with design |
| **Studio** | Theme, sections, page-by-page content (home, catalogue, product, cart, checkout, about, contact form…) | Visual store editor | ✏️ Checkout page repeats **minimum order** and **cash on delivery**, already in Store setup; two places edit the same value |
| **Store orders** | Scan-to-pack workflow | Packing desk | 🧰 an operations screen, not a setting; Orders & delivery now covers it |
| **Store enquiries** | Inbox / replied / archived | Contact form messages | 🧰 an inbox; move to Orders or Customers |
| **Item defaults** (profile anchor) | Same toggles as Billing preferences | | 🔀 duplicate link |
| **Label templates** | Template designer (size, format, rows/cols, margins, fields with position/font) | Barcode labels | ✅ |
| **Item categories** | Links to `/items/categories` | Master data | ✏️ it's master data; fine as a shortcut |
| **Offline sync** | Re-download catalogue, queue, conflicts, sync log | Offline billing diagnostics | 🧰 move to Help > Diagnostics |
| **Workflow automation** | Trigger (invoice created, payment received, overdue, low stock) and actions (email, WhatsApp, status, task) | No-code automations | ✏️ overlaps with WhatsApp reminders; label what each does |

### 2.3 People (HR) band

| Screen | Options | What it is for | Verdict |
|---|---|---|---|
| Departments & designations | Master lists | Org structure | ✅ |
| Employee management | Probation length and unit, auto-confirm, employee ID prefix and padding, dashboard visibility (new joiners, anniversaries, department heads) | Employee lifecycle defaults | ✅ |
| Exit process | Default notice, seniority rules, resignation approval chain (min/max levels), exit reasons | Separations | ✅ |
| Shifts | Name, start, end, break, deduct break | Working hours | ✅ |
| Shift roster / Bulk assign | Links to HR operations | Scheduling | 🧰 operations, keep as shortcuts |
| Weekly off | Fixed days, Nth-weekday rules | Working-day calendar | ✅ |
| **Holiday lists** and **Holiday calendar** (`/settings/holidays`) | Both: date, name, recurring, description; lists add branch, year and CSV import | Holidays | 🔀 two screens do the same job; keep Holiday lists |
| Overtime policy | Notice, comp-off type, backdating, justification, pay rules (multiplier / fixed / comp-off), minimum minutes, break exclusion, approval chain | OT | ✅ |
| Attendance policy | Late detection mode, grace, free lates, deduction style and amount, half-day/absent deductions, daily-rate basis, monthly cap, geofence (lat/long/radius) | Attendance → payroll | ✅ (long; split into Late / Deductions / Geofence cards) |
| Regularization | Enable, what can be requested, weekly/monthly limits, backdate, minimum minutes, reason required | Attendance corrections | ✅ |
| **Leave plan** and **Leave types** | Plan: name, year start, encashment rate, policy URL, apply-on-behalf; per type: quota, accrual, notice, year-end, carry cap, rounding, approval chain. Types: name, code, max days, carry forward, approval, paid | Leave rules | 🔀 carry-forward and quota live on both screens; one place per rule |
| HR approvals | Leave approver mode, expense approver mode, HR override, offer approval levels | Who approves | ✅ |
| Leave year-end / Import balances | HR operations | | 🧰 |
| Payroll settings | Pay day, EPF (ID, ceiling, rates), ESI (code, ceiling), Professional tax (state, registration) | Statutory payroll | ✅ |
| Salary components | Code, name, earning/deduction, calculation | Pay structure catalogue | ✅ |
| Commission rules | Apply to employee/role, percent/fixed/tiered, min sale, max commission, effective dates | Sales commission | ✅ |
| Hiring defaults | Links to templates; auto-send portal invite on hire | Recruitment | ✅ |
| Onboarding templates | Tasks (type, due days, required, active), invite email (subject, button, intro, footer, OTP steps) | Candidate onboarding | ✅ |
| Offer letter template | Layout, watermark, CTC table, signatory name and title, live preview | Offer letters | ✅ |
| Portal & kiosk | Attendance kiosk on/off, portal address (slug), portal links | Employee self-service | ✅ |

### 2.4 WhatsApp band

| Screen | Options | What it is for | Verdict |
|---|---|---|---|
| Connection | QR link / disconnect, Meta Cloud API (WABA ID, phone number ID, webhook) | Sending number | ✅ |
| Templates | Template per event (19 events), create/submit to Meta, category, language, header/footer, samples | Approved wording | ✅ |
| Notifications | Auto payment reminders: send time, time zone, before-due days, after-due repeat, attach PDF; manual send and history; "Updates for you" owner summary | Reminders | 🔀 payment reminders are a **Payments** setting delivered by WhatsApp; owner summary is a personal notification |
| Inbox & team | Auto-resolve quiet chats, which chats each agent sees, saved replies, flows | Shared inbox | ✅ |
| Agents | Agent name, phone, email, password, move to Billing | Connect seats | ✅ |
| AI agent | Profile and tone, knowledge (FAQs, files, sources), products, skills (orders, status, lead qualification), payments, hours and handoff, test numbers, provider/model/API key, daily cap | WhatsApp AI | ✅ (rich and well organised; the model for other pages) |
| Shop | Take orders on/off, which items, hide out-of-stock, welcome message, Meta catalogue ID and sync | WhatsApp commerce | 🔀 belongs with Orders & delivery / Online store |

### 2.5 Integrations & system band

| Screen | Options | What it is for | Verdict |
|---|---|---|---|
| All integrations | Marketplace list with search | Third-party apps | ✅ |
| Payment providers (`/settings/payments`) | Gateways (Razorpay, Easebuzz…), preferred provider, manual payment methods | Collecting money online | 🔀 the single home for all money-in settings |
| CRM integrations, SMS | Filtered marketplace | | ✅ |
| Email (SMTP) | Enable, host, port, SSL, username, from email and name, reply-to, test | Send documents by email | ✅ (move to Messaging) |
| Appearance (`/settings/features`) | Light/dark (this device), primary colour, accent colour, font, reset | Theme | ✏️ URL is `/features` but the page is Appearance |
| Backup & restore | Backup now, restore (replace/merge), Google Drive with **your own OAuth client ID/secret**, schedule (daily/weekly/monthly, time, day), destination, retention, history | Data safety and export | ⚠️ asking a shop owner to create a Google Cloud OAuth app is not usable; Khatario should own the OAuth app |
| Help & support, How-to guides | Tours, guides | | 🧰 keep in Help |

### 2.6 Settings that live outside the settings area

| Where | Options | Problem |
|---|---|---|
| Orders & delivery → **Buyer updates** dialog | WhatsApp per delivery status (8 toggles), dispatch SLA hours, late-order alert to owner, **auto-track bills with shipping address**, **delay notice days** | Delivery rules are split between Storefront (partner, Shiprocket, zones, returns window), this dialog and WhatsApp Shop. There is no single "Delivery" settings page. |
| Quick-settings sheets (top bar and Items list, `lib/module-settings.ts`) | Shortcut menus for Invoice & print, Items, Parties, Inventory, HR, WhatsApp | ✅ Good idea, but "Party settings → Custom fields" opens **invoice** custom fields, and "Party settings → Business profile" is not a party setting. |
| Item form | Per-item "Allow sale when out of stock" | Fine. It overrides the business default. |
| Invoice form | Round-off, prices include GST, due date | Per-bill. There is **no business default** for round-off, GST-inclusive prices, default due days or default notes/terms. Vyapar and myBillBook both have these. |

### 2.7 Phone app (Flutter)

| What exists | Gap |
|---|---|
| Appearance screen (proper UI) | — |
| 13 settings routes in `page_catalog.dart` (WhatsApp, Branches, Users, Roles, Warehouses, Financial years, Period locks, Plan, Business, Templates, Online store, Store enquiries, Store orders) open the **generic RecordPage**. Editable ones use `SettingsEditor`, which turns the API response's raw keys into text boxes. | No toggles, no pickers, no sections, raw field names, no plan locks, no validation. Business profile, Billing preferences, Payments, Number series, Buyer updates, Reminders and Print are the settings phone users actually change, and none has a real screen. |

---

## 3. Findings, ranked

**P0: wrong or harmful**
1. **Roles page shows a developer message** ("Permissions need to be seeded. Please run migration 059_rbac.sql") to customers. It should say "Permissions are being set up, try again in a minute" and alert support.
2. **Backup to Google Drive requires the merchant to create a Google Cloud OAuth app** (client ID, secret, redirect URI). Almost no shop owner can do this. Khatario should register one OAuth app and offer "Connect Google Drive".
3. **Two places edit the same value:** store minimum order and cash on delivery (Storefront › Store setup and Studio › Checkout); UPI/payment methods (Business profile and Payments); holidays (Holiday lists and Holiday calendar); leave carry-forward and quota (Leave types and Leave plan). Whichever saves last wins, so owners see changes "revert".
4. *(Fixed today.)* The online-store stock check ignored **"Allow sales when out of stock"**, so made-to-order items would have been refused at checkout. It now respects the item setting and the business default, with a test.

**P1: findability and trust**
5. Grouping follows internal products (Billing / People / Connect) rather than tasks. "Delivery", "Payments" and "Invoices" are each spread over 3–4 screens.
6. Business profile is overloaded (identity + GST + bank + UPI + AI text + exporter + stock/POS behaviour + print language). It is the most visited settings page and the slowest to scan.
7. **Stale plan copy:** "Upgrade to Enterprise" (Branches, Warehouses) when plans are Free / Growth / Business. Studio says online payment "appears when Razorpay is connected" though Easebuzz is also supported.
8. **Save behaviour is inconsistent:** Billing preferences save instantly, Storefront and Store Studio need Save/Publish, the AI agent and Shop have per-card Save plus an "unsaved changes" bar, and others have a page Save button. Owners can't predict whether a change is applied.
9. Non-settings sit in settings: Store orders, Store enquiries, Offline sync, Printer diagnostics, Activity logs, Shift roster, Leave year-end, Import balances. They clutter the hub.
10. **Missing business defaults** that competitors have: default due days, default invoice notes and terms, round-off default, prices-include-GST default, default place-of-supply rule, low-stock threshold default, default payment mode, decimal places for quantity and rate.
11. User access is split over 4 screens (User management landing, Manage users, User branches, User warehouses). It should be one user detail screen with Role, Branches and Warehouses sections.

**P2: polish**
12. Mixed casing: "Manage Users", "Manage roles", "Transaction Number Series", "Account Mappings".
13. Route and name mismatch: `/settings/features` is "Appearance". The eight redirect routes (invoice, tax, gst-config, signature, export, ai-agent ×3) should stay as permanent redirects but not be linked anywhere.
14. Quick-settings sheet mislinks: Party settings → invoice custom fields; there are no party custom fields at all (customer fields like birthday, credit days, area are common asks).
15. Account mappings use accounting jargon with no "what happens if I change this" help. Changing them mid-year has ledger consequences that aren't explained.
16. Phone app has no real settings (section 2.7).

---

## 4. Recommended structure (information architecture)

Group by the owner's job. Nine groups, each a page with sections. The hub search and the sidebar stay the same component; only the registry changes.

| # | Group | Contents (sections) | Merges / moves |
|---|---|---|---|
| 1 | **Business** | Profile (name, contact, address) · GST & tax · Logo & signature · Branches · Warehouses · Exporter details (collapsed) | Bank/UPI, AI text and billing preferences move out |
| 2 | **Invoices & documents** | Invoice defaults (**new**: due days, notes/terms, round-off, prices incl. GST, decimals) · Bill screen (POS mode, variants) · Number series · Templates & printing (one customizer) · Print language · Custom fields (items, invoices, **parties**) | From Business profile, plus new defaults |
| 3 | **Payments** | Bank accounts · UPI & payment methods · Payment gateways & preferred provider · Payment reminders (schedule, before/after due, attach PDF) | One home for all money-in settings |
| 4 | **Items & stock** | Stock rules (allow sale when out of stock, low-stock default) · Categories · Units · Label templates · Printers & devices | |
| 5 | **Orders & delivery** | Online store setup (URL, live, min order, COD) · Delivery (partner, Shiprocket, zones, pickup) · Returns (window, enable) · Buyer updates (per-status WhatsApp, delay notice) · Dispatch rules (SLA, owner alert, auto-track bills) · WhatsApp shop | Brings together Storefront setup, Buyer updates dialog and WhatsApp Shop. Store **design** (themes, Studio, pages, promo) stays under **Online store › Design**. |
| 6 | **Accounting** | Financial years · Period locks · Account mappings (Advanced) | |
| 7 | **Team & access** | Users (one detail page: role, branches, warehouses, devices) · Roles & permissions · WhatsApp agents · Activity log (link) | Removes User management, User branches, User warehouses |
| 8 | **Messaging & AI** | WhatsApp connection · Templates · Inbox & team · AI agent · Email (SMTP) · SMS · Owner updates (evening summary) | |
| 9 | **People (HR)** | As today, with Holiday lists only and one leave screen (plan, then types inside it) | |
| — | **Plan & data** | Your products · Plan & billing · Backup & export (Khatario-owned Drive connect) · Appearance | |
| — | **Help** | Guides · Tours · Diagnostics (offline sync, printer) | |

Operational screens leave settings: Store orders becomes Orders & delivery; Store enquiries becomes an inbox tab under Orders or Customers; Shift roster and the leave tools stay in HR.

---

## 5. How each settings page should be designed

One pattern for every page, web and phone. The AI agent page already comes closest and is the model.

**Layout (web, ≥1024px)**
- Left: persistent settings sidebar with the 9 groups (current component, new registry). Top: search ("/" shortcut, already built).
- Content column max 760px. A page = title + one-line purpose + **section cards**. A sticky in-page section index on the right appears when there are more than 4 sections (Business profile already does this).
- Each **section card** has a title, one sentence on *why* it matters ("Printed on every invoice. GST requires it."), then rows.
- Each **row** has the label and helper text on the left, the control on the right (toggle, select, short input), and the current value visible without opening anything. Long inputs (address, terms, HTML) go full width under the label.
- **Completeness:** a "Missing, needed on invoices" chip on rows the business must fill (already exists in ProfileSection). Show it in the hub as "Business profile · 2 to fill".
- **Plan-locked options** stay visible with a small lock pill and one-line value ("Print in Hindi, Marathi… on Growth"). Tapping opens the upgrade sheet. Never hide them and never show a full-page "Feature locked" wall when only one option is locked.
- **Advanced** options (account mappings, custom CSS, API base URL, webhook tokens) go in a collapsed "Advanced" disclosure at the bottom of their card.
- **Danger zone** (disconnect WhatsApp, delete branch, restore backup, unlock period) goes in a separate red-bordered card at the bottom, each behind a typed confirmation.

**Saving: one rule everywhere**
- **Toggles and selects save instantly** with a small "Saved" toast and undo.
- **Text and number fields** use the sticky bottom Save bar (`SettingsFloatingSaveBar` exists) that appears only when something changed, with Discard.
- **Designers** (Store Studio, template customizer, label designer) keep Draft → Publish, labelled clearly as "Draft".
- Leaving with unsaved changes asks for confirmation.

**Mobile web and phone app**
- Hub = grouped list rows with an icon, label and a **current value or status** on the right ("GST · Regular", "Reminders · On, 10 am", "Store · Live").
- Each group opens a full-screen page with the same section cards; rows use the phone kit (KCard rows, KSegmented, switches, `showKPicker` for choices). Save bar sits above the keyboard.
- Replace `SettingsEditor`'s raw key → text-box screen with native screens for the high-traffic groups first: **Business**, **Invoices & documents** (defaults and number series), **Payments** (UPI and reminders), **Orders & delivery** (buyer updates, delivery, returns), **Printers**. Keep the rest as "Open on web" rows until built.

**Wording**
- Sentence case everywhere ("Manage users", "Number series").
- Labels describe the outcome, not the mechanism ("Track bills that have a shipping address", not "auto_track_shipped_bills").
- No migration names, table names, or provider internals in customer-facing text.

---

## 6. Suggested order of work

1. **P0 fixes** (½ day): roles migration message; stale "Enterprise" and "Razorpay only" copy; remove the duplicate controls (Studio checkout min order/COD become read-only links to Store setup; Payments becomes the only UPI editor; Business profile links to it; retire `/settings/holidays`).
2. **Registry re-group** (1–2 days): new 9 groups in `settings-module-registry.ts`, move links, retire User management / User branches / User warehouses into the user detail page, move operational screens out.
3. **New "Invoice defaults" and "Orders & delivery" settings pages** (2–3 days): add the missing defaults; bring together the delivery settings now spread over Storefront, the Buyer updates dialog and WhatsApp Shop.
4. **Business profile split** (1 day): profile and GST only; billing preferences, bank/UPI, AI text and print language move to their new homes.
5. **Unified save behaviour** (1–2 days): instant toggles plus a sticky Save bar on every form page.
6. **Phone settings** (3–4 days): native screens for the five high-traffic groups, replacing `SettingsEditor` for them.
7. **Backup**: a Khatario-owned Google Drive connection (needs a Google Cloud project on Khatario's side).

Fixed during this audit: online-store checkout now respects "Allow sales when out of stock" (`lib/store/checkout-stock.ts`, test in `tests/db/store-checkout-stock.db.test.ts`).
