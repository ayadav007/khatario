# Khatario roadmap

`##` headings are columns, bullets are cards, `[[path]]` opens the full brief. Move a card by moving its bullet. Rules: [brain.md](brain.md).

## Now
- Write-handler identity hardening: never trust client-sent `business_id` or acting user on the remaining routes (accounts, bank accounts, employees, warehouses, bundles) [[docs/qa/README.md]]
- Orders and delivery: close the fulfilment gaps [[docs/plan/ORDERS_FULFILMENT_GAPS.md]]

## Next
- Distributor invoice template: phase 2 (licences, salesman, scheme discount, free qty, batch and MRP on lines; migration 435) [[docs/plan/DISTRIBUTOR_INVOICE_TEMPLATE.md]]
- Phone app: move screens from prototype to live data [[docs/plan/PHONE_APP.md]]
- Printing makeover: thermal, label and A4 printing on every platform [[docs/plan/PRINTING_MAKEOVER.md]]
- Staff attendance check-in: face recognition pass

## Later
- QA: purchase and purchase-return browser pass on staging [[docs/qa/phase-3q-browser-functional-results.md]]
- Global search ranked with `pg_trgm` or `tsvector` [[docs/IMPLEMENTATION-LOG.md]]
- Golden tests for GSTR-1 and tax report amounts [[docs/IMPLEMENTATION-LOG.md]]

## Parked
- Demo booking: Meet invite and confirmation [[docs/BACKLOG.md]]
- Assistant Phase 2 [[docs/BACKLOG.md]]

## Done
- Supplier Hub P0, P1 and Order list (Oct 2026) [[docs/SUPPLIER_HUB_BUILD_PLAN.md]]
- Salary prefill fix for employees with a joining date (e93ac7f1)
- QA test phones: no WhatsApp sends on staging, OTP shown on screen (eb3ef519)
