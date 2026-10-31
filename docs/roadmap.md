# Khatario roadmap

`##` headings are columns, bullets are cards, `[[path]]` opens the full brief. Move a card by moving its bullet. Rules: [brain.md](brain.md).

## Now
- Staging QA run: apply migration 432 (HR monthly limits, needs owner approval), then attendance, payroll and payslips [[docs/qa/staging-scenario-results.md]]
- Orders and delivery: close the fulfilment gaps [[docs/plan/ORDERS_FULFILMENT_GAPS.md]]
- Store khata: built, checked in the browser on the test DB and committed; next migration 444 on staging (owner approval) and the khata-statements cron line at deploy [[docs/plan/STORE_KHATA.md]]

## Next
- Store page customisation, sub-project 1 of 4: header and footer menus (dropdowns, mega menus, automatic categories, phone side panel); built and committed on main (not pushed), final review clean; next: deploy and staging check [[docs/superpowers/plans/2026-10-31-store-menus.md]]. Then cart page, checkout page, sign-up and login page, each with its own spec [[docs/superpowers/specs/2026-10-31-store-menus-design.md]]
- Connect leads: sub-project 1 (leads table, pipeline on leads, repeat enquiries, no-chat leads, convert to customer, Leads page) built, final review clean, committed on main (migrations 447 and 451 on the test DB only); next: deploy with 447 + 451 + 452 (owner approval, quiet window, re-run 447 after reload), then the next deploy adds the 451 phase-2 constraint drop, lead comments from chat notes built (migration 452); then sub-project 2 lead score and 3 template broadcast by segment [[docs/plan/CONNECT_LEADS.md]] [[docs/SERVER_INFRASTRUCTURE.md]]
- Template designer and gallery redesign: phases A–C built, owner review, then commit [[docs/plan/TEMPLATE_DESIGNER_REDESIGN.md]]
- Distributor invoice template: phase 2 (licences, salesman, scheme discount, free qty, batch and MRP on lines; migration 435) [[docs/plan/DISTRIBUTOR_INVOICE_TEMPLATE.md]]
- Warehouse mode: transit loss on a transfer leaves item and branch stock one too high (F-018) [[docs/qa/staging-scenario-results.md]]
- Data fix: give back input tax credit to businesses already signed up as retail + food (F-014) [[docs/qa/staging-scenario-results.md]]
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
- Post-sale discount credit note: one GST credit note over a supply period, no single-invoice link (s.15(3)(b), Finance Act 2026); migration 443 [[docs/plan/POST_SALE_DISCOUNT_CREDIT_NOTE.md]]
- Sell in alternate units (BOX of 12) on invoices, orders, challans, POS and the phone form; migration 438 [[docs/plan/SELL_IN_ALTERNATE_UNITS.md]]
- Supplier Hub: short/damaged goods choice on receipt (F-008) and size/colour-aware purchase returns; migration 436
- Repack bulk stock into packs; migration 439 [[docs/REPACK_STOCK_DESIGN.md]]
- Write-handler identity hardening: acting user from the session on HR, warehouse, bank-account and account writes (3e8e6be0)
- Restaurant / food service business type; grocery shops keep ITC (b72a28d0)
- Final invoices can be amended until GSTR-1 is filed (49005880)
- Supplier Hub P0, P1 and Order list (Oct 2026) [[docs/SUPPLIER_HUB_BUILD_PLAN.md]]
- Salary prefill fix for employees with a joining date (e93ac7f1)
- QA test phones: no WhatsApp sends on staging, OTP shown on screen (eb3ef519)
