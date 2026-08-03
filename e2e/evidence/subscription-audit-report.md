# Subscription Browser Audit Evidence

**Generated:** 2026-06-23T17:45:39.203Z
**Base URL:** http://localhost:3101
**Scenarios:** 10/10 passed

## login: Login: hr

- **Persona:** hr
- **Passed:** YES
- **URL visited:** http://localhost:3101/login
- **Final URL:** http://localhost:3101/hr/dashboard
- **User action:** Login with phone 88366156091
- **Result:** Landed on http://localhost:3101/hr/dashboard
- **Pricing visible:** false
- **CTA:** —
- **Checkout reached:** false

**Visible copy:**
```
No Internet Connection Found

MB
My Business
Menu & profile tour
Today
This Week
This Month
Custom Range
HR is not enabled

Add the HR module from Settings to use this dashboard.

View plans
```

**Screenshots:**
- `e2e\evidence\login-login-hr.png`

## login: Login: billing

- **Persona:** billing
- **Passed:** YES
- **URL visited:** http://localhost:3101/login
- **Final URL:** http://localhost:3101/dashboard
- **User action:** Login with phone 88366156092
- **Result:** Landed on http://localhost:3101/dashboard
- **Pricing visible:** false
- **CTA:** —
- **Checkout reached:** false

**Visible copy:**
```
No Internet Connection Found

MB
My Business
Menu & profile tour
Today
This Week
This Month
Custom Range
```

**Screenshots:**
- `e2e\evidence\login-login-billing.png`

## login: Login: connect

- **Persona:** connect
- **Passed:** YES
- **URL visited:** http://localhost:3101/login
- **Final URL:** http://localhost:3101/whatsapp/dashboard
- **User action:** Login with phone 88366156093
- **Result:** Landed on http://localhost:3101/whatsapp/dashboard
- **Pricing visible:** false
- **CTA:** —
- **Checkout reached:** false

**Visible copy:**
```
No Internet Connection Found

MB
My Business
Menu & profile tour

Please select a business
```

**Screenshots:**
- `e2e\evidence\login-login-connect.png`

## login: Login: multi

- **Persona:** multi
- **Passed:** YES
- **URL visited:** http://localhost:3101/login
- **Final URL:** http://localhost:3101/dashboard
- **User action:** Login with phone 88366156094
- **Result:** Landed on http://localhost:3101/dashboard
- **Pricing visible:** false
- **CTA:** —
- **Checkout reached:** false

**Visible copy:**
```
No Internet Connection Found

MB
My Business
Menu & profile tour
Today
This Week
This Month
Custom Range
```

**Screenshots:**
- `e2e\evidence\login-login-multi.png`

## A1: HR → Billing: route guard upsell

- **Persona:** hr
- **Passed:** YES
- **URL visited:** http://localhost:3101/invoices
- **Final URL:** http://localhost:3101/settings/products?upsell=billing
- **User action:** Navigate to /invoices
- **Result:** Redirected to http://localhost:3101/settings/products?upsell=billing
- **Pricing visible:** false
- **CTA:** —
- **Checkout reached:** false

**Visible copy:**
```
That area needs Billing

GST invoicing, inventory, purchases, and reports.

Add Billing
```

**Screenshots:**
- `e2e\evidence\A1-hr-billing-upsell.png`

**Notes:**
- No pricing on upsell banner

## B1: Billing → HR: route guard upsell

- **Persona:** billing
- **Passed:** YES
- **URL visited:** http://localhost:3101/employees
- **Final URL:** http://localhost:3101/settings/products?upsell=hr
- **User action:** Navigate to /employees
- **Result:** Redirected to http://localhost:3101/settings/products?upsell=hr
- **Pricing visible:** false
- **CTA:** —
- **Checkout reached:** false

**Visible copy:**
```
Quick tour
```

**Screenshots:**
- `e2e\evidence\B1-billing-hr-upsell.png`

**API checks:**
- GET /api/employees (billing-only): HTTP 403 — {"error":"This HR feature is not included in your subscription plan.","code":"FEATURE_NOT_IN_PLAN","details":{"error":"Feature not available in your plan","code":"FEATURE_NOT_IN_PLAN","feature":"hr_em

## C1: Billing → Connect: route guard upsell

- **Persona:** billing
- **Passed:** YES
- **URL visited:** http://localhost:3101/whatsapp/dashboard
- **Final URL:** http://localhost:3101/settings/products?upsell=connect
- **User action:** Navigate to /whatsapp/dashboard
- **Result:** Redirected to http://localhost:3101/settings/products?upsell=connect
- **Pricing visible:** false
- **CTA:** —
- **Checkout reached:** false

**Visible copy:**
```
That area needs Connect

WhatsApp inbox, bot, and customer messaging.

Add Connect
```

**Screenshots:**
- `e2e\evidence\C1-billing-connect-upsell.png`

**API checks:**
- GET /api/subscriptions/addons (billing-only, authenticated): HTTP 200 — {"addons":[{"id":"whatsapp_bot","name":"WhatsApp Bot","display_name":"WhatsApp Bot & Conversations","description":"Access to WhatsApp Conversations, Bot Rules, and advanced automation features","price

## D1: Connect → Billing: route guard upsell

- **Persona:** connect
- **Passed:** YES
- **URL visited:** http://localhost:3101/invoices
- **Final URL:** http://localhost:3101/settings/products?upsell=billing
- **User action:** Navigate to /invoices
- **Result:** Redirected to http://localhost:3101/settings/products?upsell=billing
- **Pricing visible:** false
- **CTA:** —
- **Checkout reached:** false

**Visible copy:**
```
That area needs Billing

GST invoicing, inventory, purchases, and reports.

Add Billing
```

**Screenshots:**
- `e2e\evidence\D1-connect-billing-upsell.png`

**API checks:**
- GET /api/invoices (connect-only, authenticated): HTTP 403 — {"error":"Feature not available in your plan","code":"FEATURE_NOT_IN_PLAN","feature":"invoices"}

**Notes:**
- Billing API correctly blocked (403)

## E1: Revenue leakage: API + direct URL

- **Persona:** hr
- **Passed:** YES
- **URL visited:** http://localhost:3101/connect/whatsapp
- **Final URL:** http://localhost:3101/connect/whatsapp
- **User action:** POST current plan=enterprise; POST modules connect; POST addon purchase; visit /connect/whatsapp
- **Result:** Plan assign 403; module 403 (MODULE_REQUIRES_CHECKOUT); addon 503; URL=http://localhost:3101/connect/whatsapp
- **Pricing visible:** false
- **CTA:** —
- **Checkout reached:** false

**Visible copy:**
```
No Internet Connection Found

EH
E2E HR 1782236615609
SIDEBAR TESTING
LEARN MORE
Menu & profile tour
E
Send invoices on WhatsApp

Link your business number to send invoices, estimates, and payment reminders from billing.

Basic WhatsApp includes connecting your number and sending invoices from billing. Bot, reminders, and inbox features require the WhatsApp Bot addon.

Connection Status
Disconnected

Not Connected

Connect your WhatsApp account to send messages

Connect WhatsApp

Need inbox, bot, and customer messaging? Add Connect on Your products
```

**Screenshots:**
- `e2e\evidence\E1-leakage-connect-url.png`

**API checks:**
- POST /api/subscriptions/current (enterprise): HTTP 403 — {"error":"Direct subscription assignment is not allowed. Use checkout or contact support.","code":"SUBSCRIPTION_ASSIGNMENT_FORBIDDEN"}
- POST /api/modules (connect): HTTP 403 — {"error":"Adding a product requires subscription checkout. Use the checkout or upgrade API with a valid plan.","code":"MODULE_REQUIRES_CHECKOUT","module_key":"connect","plan_id":"connect","checkout_en
- POST /api/subscriptions/addons/whatsapp_bot/purchase: HTTP 503 — {"error":"Online payments are not configured yet. Please contact support to purchase add-ons.","code":"PAYMENT_NOT_CONFIGURED"}

**Notes:**
- Plan assign blocked (403 SUBSCRIPTION_ASSIGNMENT_FORBIDDEN)
- Module add correctly requires checkout
- Addon blocked when payments not configured

## F1: Multi-product: subscription settings

- **Persona:** multi
- **Passed:** YES
- **URL visited:** http://localhost:3101/settings/subscription
- **Final URL:** http://localhost:3101/settings/subscription
- **User action:** Open /settings/subscription
- **Result:** Modules: billing, hr
- **Pricing visible:** false
- **CTA:** —
- **Checkout reached:** false

**Visible copy:**
```
No Internet Connection Found

EM
E2E MULTI 1782236615609
SIDEBAR TESTING
LEARN MORE
Menu & profile tour
E
Subscription & Billing
Subscription & Billing

Manage your plan and billing information
```

**Screenshots:**
- `e2e\evidence\F1-multi-subscription-settings.png`
