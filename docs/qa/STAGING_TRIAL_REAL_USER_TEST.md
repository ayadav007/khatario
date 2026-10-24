# Staging real-user test: signup, trial, core features, trial expiry

**Target:** `https://staging.khatario.com` (never production)
**Test phone:** 7769870606 (owner relays the WhatsApp OTP)
**Driver:** Playwright MCP browser, acting as a new business owner

Record for every case: Pass / Fail / Blocked, a screenshot, and any console or API error.

---

## Phase A — Registration and trial

| ID | Case | Steps | Expected |
|----|------|-------|----------|
| A1 | Signup page loads | Open `/signup` | Form renders, no console errors |
| A2 | OTP request | Enter 7769870606, request code | "Code sent" state; WhatsApp message arrives on the phone |
| A3 | Wrong OTP | Enter `000000` | Clear error, no account created |
| A4 | Correct OTP + signup | Enter relayed code, business name "QA Trial Traders", password, submit | Lands on dashboard / onboarding |
| A5 | Trial is on | Look at top-bar badge and `/settings/subscription` | Badge shows the trial plan once (no "Trial (Trial)"); 30 days remaining; trial end = today + 30 |
| A6 | Logout / login | Log out, log in with phone + password | Back on dashboard, still on trial |
| A7 | Business profile | `/settings` → business profile: address, state, GSTIN (optional) | Saves; required-profile prompts disappear |

## Phase B — Features during trial (full access expected)

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| B1 | Items | Create 3 items (goods with HSN + GST 18%, goods GST 5%, a service) | Saved; appear in list and search |
| B2 | Customers | Create 2 customers (one B2B with GSTIN, one B2C) | Saved |
| B3 | Suppliers | Create 1 supplier | Saved |
| B4 | Sales invoice | New invoice to B2B customer, 2 lines | Totals + CGST/SGST correct; invoice number assigned |
| B5 | Invoice view / PDF | Open invoice, view/print PDF | PDF renders, amounts match |
| B6 | Share invoice | Share via WhatsApp / link | Share dialog works; no internal labels shown |
| B7 | Payment | Record full payment against B4 | Invoice status → Paid; ledger updated |
| B8 | Estimate | Create estimate, convert to invoice | Converted invoice has same lines |
| B9 | Credit note | Credit note against B4 | Saved; customer balance reduced |
| B10 | Purchase bill | Purchase from supplier, 2 lines | Stock increases; input GST recorded |
| B11 | Purchase order | Create PO | Saved |
| B12 | Expense | Record an expense | Saved |
| B13 | Stock | Check item stock after B4 + B10 | Stock = opening + purchase − sale |
| B14 | Reports | Sales report, GSTR-1, P&L / Trial balance | Load without error; B4 shows in GSTR-1 |
| B15 | Ledger | Customer ledger for B2B customer | Invoice, payment, credit note entries |
| B16 | Users | Invite a second user | Allowed during trial |
| B17 | WhatsApp settings | `/whatsapp` or settings → WhatsApp | Page loads (connect not required) |
| B18 | Dashboard | Dashboard totals | Reflect B4/B7/B10 |

## Phase C — Trial ending (timeline moved by SQL)

Run the SQL from the appendix on the staging VPS, then reload the app.

| ID | Case | Setup SQL | Expected |
|----|------|-----------|----------|
| C1 | Last day | `S1` (trial ends today) | Still full trial access; 1 day remaining |
| C2 | 7-day reminder | `S2` (ends in 7 days) + trigger cron | `trial_expiring_7` notification row; email copy says "moves to Free", no grace promise |
| C3 | Expired, undecided | `S3` (ended yesterday) | Extend-or-Free modal shown; app is NOT locked out; badge shows Free |
| C4 | Free limits apply | after C3 | Create invoice/customer within Free limits works; features not on Free show upgrade prompt (403 `FEATURE_NOT_IN_PLAN`), never `TRIAL_EXPIRED` |
| C5 | Historical data | after C3 | All Phase B records still viewable |
| C6 | Expired email | after `S3` + trigger cron | One `trial_expired` notification row for the business |
| C7 | Extend once | Click "Extend 7 days" | Trial again, 7 days remaining; module row matches (`Q2`) |
| C8 | Extension expires | `S4` + trigger cron | Moved to Free (`plan_id=free`, `status=active`); module row matches |
| C9 | Decline path | Reset with `S5`, then `S3`, click "Continue on Free" | Free plan; no extend option afterwards; module row matches |
| C10 | Upgrade mid-trial | Reset with `S5` (ends in 10 days), upgrade to a paid plan (staging payment / admin) | Paid `end_date` = period end + 10 days; event has `trial_days_carried = 10` |

---

## Appendix — SQL for the staging VPS

Run inside `psql` against the **staging** database. Every statement is scoped to the test business.

```sql
-- Q1: find the test business (run first; the rest use this lookup)
SELECT b.id, b.name, b.product_line, b.primary_module, u.phone
FROM users u JOIN businesses b ON b.id = u.business_id
WHERE u.phone LIKE '%7769870606' AND u.is_primary_admin;

-- Q2: current subscription state (legacy row + module rows)
SELECT plan_id, status, start_date, trial_end_date, end_date,
       trial_extension_granted, trial_extension_declined_at
FROM business_subscriptions
WHERE business_id = (SELECT business_id FROM users WHERE phone LIKE '%7769870606' AND is_primary_admin LIMIT 1);

SELECT module_key, plan_id, status, trial_end_date, end_date
FROM business_module_subscriptions
WHERE business_id = (SELECT business_id FROM users WHERE phone LIKE '%7769870606' AND is_primary_admin LIMIT 1);
```

Timeline shifts. Each updates both tables so feature checks and the legacy row agree. Replace the interval as needed.

```sql
-- S1: trial ends today
-- S2: ends in 7 days   -> use  CURRENT_DATE + 7
-- S3: ended yesterday  -> use  CURRENT_DATE - 1
BEGIN;
WITH biz AS (SELECT business_id FROM users WHERE phone LIKE '%7769870606' AND is_primary_admin LIMIT 1)
UPDATE business_subscriptions SET trial_end_date = CURRENT_DATE, updated_at = NOW()
WHERE business_id = (SELECT business_id FROM biz) AND status = 'trial';
WITH biz AS (SELECT business_id FROM users WHERE phone LIKE '%7769870606' AND is_primary_admin LIMIT 1)
UPDATE business_module_subscriptions SET trial_end_date = CURRENT_DATE, updated_at = NOW()
WHERE business_id = (SELECT business_id FROM biz) AND status = 'trial';
COMMIT;

-- S4: extension used and already expired (for C8)
BEGIN;
WITH biz AS (SELECT business_id FROM users WHERE phone LIKE '%7769870606' AND is_primary_admin LIMIT 1)
UPDATE business_subscriptions SET trial_end_date = CURRENT_DATE - 1, trial_extension_granted = true, updated_at = NOW()
WHERE business_id = (SELECT business_id FROM biz) AND status = 'trial';
WITH biz AS (SELECT business_id FROM users WHERE phone LIKE '%7769870606' AND is_primary_admin LIMIT 1)
UPDATE business_module_subscriptions SET trial_end_date = CURRENT_DATE - 1, updated_at = NOW()
WHERE business_id = (SELECT business_id FROM biz) AND status = 'trial';
COMMIT;

-- S5: reset to a fresh trial ending in 10 days (undo extend/decline)
BEGIN;
WITH biz AS (SELECT business_id FROM users WHERE phone LIKE '%7769870606' AND is_primary_admin LIMIT 1)
UPDATE business_subscriptions
SET plan_id = 'trial', status = 'trial', trial_end_date = CURRENT_DATE + 10, end_date = NULL,
    trial_extension_granted = false, trial_extension_declined_at = NULL, updated_at = NOW()
WHERE business_id = (SELECT business_id FROM biz);
WITH biz AS (SELECT business_id FROM users WHERE phone LIKE '%7769870606' AND is_primary_admin LIMIT 1)
UPDATE business_module_subscriptions
SET plan_id = 'trial', status = 'trial', trial_end_date = CURRENT_DATE + 10, end_date = NULL, updated_at = NOW()
WHERE business_id = (SELECT business_id FROM biz) AND module_key = 'billing';
COMMIT;

-- Q3: notifications and events for the business
SELECT notification_type, sent_at FROM subscription_notifications
WHERE business_id = (SELECT business_id FROM users WHERE phone LIKE '%7769870606' AND is_primary_admin LIMIT 1)
ORDER BY sent_at DESC;
SELECT event_type, from_plan_id, to_plan_id, details, created_at FROM subscription_events
WHERE business_id = (SELECT business_id FROM users WHERE phone LIKE '%7769870606' AND is_primary_admin LIMIT 1)
ORDER BY created_at DESC LIMIT 10;
```

Trigger the daily cron on the VPS (uses the staging `CRON_SECRET`):

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://staging.khatario.com/api/cron/check-subscriptions
```

The app caches subscriptions briefly; after SQL changes, wait ~1 minute or log out and back in.

## Results — run of 2026-09-27

Test business `5ee47b2a-47bf-4e93-84ff-cf2142fd2e0e` (QA Trial Traders), phone-only signup (no email on business or admin).

| Case | Result | Notes |
|------|--------|-------|
| A1–A7 | Pass | |
| B1–B4, B7, B10, B13 | Pass | Invoice header showed "Cash Sale" for a customer invoice (fixed in code) |
| B5 | Pass | PDF and image render |
| B6, B15, B16 | Not run | |
| B8 | Fail | "Convert to Invoice" opened an empty form; `convert_from` was never read (fixed in code; sales-order convert still unwired) |
| B9 | Pass | CN-001 ₹354; stock restored; customer credit −₹354 |
| B11 | Pass | PO-001 ₹2,625 |
| B12 | Pass | Saved without a category — new businesses get no expense categories |
| B14 | Pass with issue | GSTR-1 correct (B2B, HSN, CDN); GSTR-3B nets tax for the credit note but not taxable value |
| B17 | Fail | WhatsApp settings 403 on a Billing-only trial with an "upgrade" message |
| B18 | Pass | |
| C1 | Pass with issue | Access correct; banner said "ends in 0 days" (fixed in code) |
| C2 | Fail | No reminder: email-only channel and the account has no email |
| C3 | Pass | Extend-or-Free modal; badge Free / Starter; modal cannot be dismissed but app stays usable |
| C4 | Pass | Free limits 20/10/10/1; gates return `FEATURE_NOT_IN_PLAN`, never `TRIAL_EXPIRED` |
| C5 | Pass | |
| C6 | Fail | Same cause as C2; no `subscription_notifications` rows ever written |
| C7 | Pass | Legacy and module rows both extended to today + 7 |
| C8 | Pass with issue | Moved to Free by cron; the user gets no notice |
| C9 | Pass | Extension refused after decline. The modal's close (X) button also declines |
| C10 | Pass | Coupon upgrade: `end_date` = +1 month + 10 days; event `trial_days_carried = 10` |

Environment findings: staging had no `CRON_SECRET` (the cron had never run; now set with a 09:00 crontab); staging has no Razorpay keys, so paid upgrades show "contact support".

## Cleanup (after testing)

Ask before deleting. Removing the test business cascades through many tables, so do it with the platform admin "delete business" action rather than raw SQL.
