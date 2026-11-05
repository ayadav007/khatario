# Khatario roadmap

`##` headings are columns, bullets are cards, `[[path]]` opens the full brief. Move a card by moving its bullet. Rules: [brain.md](brain.md).

## Now
- Staging QA run: apply migration 432 (HR monthly limits, needs owner approval), then attendance, payroll and payslips [[docs/qa/staging-scenario-results.md]]
- Orders and delivery: close the fulfilment gaps [[docs/plan/ORDERS_FULFILMENT_GAPS.md]]
- Order returns release 1: Shiprocket return pickup on approval, refund to original payment, return WhatsApp messages, not-returnable products, five Shiprocket/return fixes; built and committed on main (not pushed), all 14 tasks reviewed, full run green; next: staging with migration 460 first (owner approval), then Shiprocket field check, Razorpay refund webhook events, `return-refunds` cron line, and the staging checklist [[docs/superpowers/plans/2026-11-01-order-returns-staging-checklist.md]] [[docs/superpowers/specs/2026-11-01-order-returns-pickup-refund-design.md]]
- Store khata: built, checked in the browser on the test DB and committed; next migration 444 on staging (owner approval) and the khata-statements cron line at deploy [[docs/plan/STORE_KHATA.md]]
- Store design switch-over (theme engine M6): every store on the new design and the Store editor's old appearance settings removed (built, not committed); next: deploy with migration 461, then `scripts/migrate-store-themes.mjs --all --switch-on` on staging (dry run first), check stores, then production; later remove the old renderer and old Studio code

## Next
- Premium store themes: plans 1 and 2 built, reviewed, merged to main and pushed (foundations + Heritage Couture preset, Collage / Shop the look / Image gallery, premium flag behind `store_premium_themes`); next: staging with migrations 458 then 459 before the code, flag on for the E2E store, run the Heritage staging checklist; then decide pricing and the flag's admin screen [[docs/superpowers/plans/2026-10-31-store-heritage-couture-staging-checklist.md]] [[docs/superpowers/plans/2026-10-31-store-heritage-couture-carryover.md]]
- Drop Culture premium theme (streetwear), batch 1 built and committed on main (not pushed), all tasks and the final review clean: fonts, hero countdown, size chips, "Only N left", fit note (migration 462, test DB only), delivery check, sticky Add to bag, photo grid, the `drop` preset and the VOLTX demo store; next: deploy with 462 first, staging checks, then batch 2 (size filter, cart drawer bar and suggestions) and batch 3 (reels, phone sign-up), and combo pricing as its own spec [[docs/superpowers/specs/2026-11-02-store-drop-culture-theme-design.md]] [[docs/superpowers/plans/2026-11-02-drop-culture-batch-1.md]]
- Bazaar Bright premium theme (modern kirana / supermarket) built and committed on main (not pushed), all 12 tasks and the final review clean: Baloo 2, pack chips and price per kg on cards, pack tiles, store hours with open badge and closed notice (migration 463, test DB only), store info, Buy again, cart free-delivery bar, suggestions and Order on WhatsApp (also completes Drop's batch 2 cart item), the `bazaar` preset and the Sharma General Store demo; next: deploy with 462 and 463 first, staging checks (spec §5) [[docs/superpowers/specs/2026-11-03-store-bazaar-bright-theme-design.md]] [[docs/superpowers/plans/2026-11-03-bazaar-bright.md]]
- Theme store: Part A built on main (public khatario.com/themes + /themes/<slug> drawing each theme live from its demo store on demo-<slug>, Apply → library + editor, Explore themes in the library; final review fixes in); next: staging checklist [[docs/superpowers/plans/2026-11-01-store-theme-store-staging-checklist.md]], then Part B ("My store" previews, live library thumbnails) and Part C (paid themes once prices are set) [[docs/superpowers/specs/2026-11-01-store-theme-store-design.md]]
- Store product cards (gap batch 3, first part): built and committed on main (not pushed), final review clean; next: deploy and staging check [[docs/superpowers/plans/2026-11-01-store-product-cards.md]]
- Store vs Shopify gap audit done; batch 1 header and hero built and committed on main (not pushed), final review clean; next: deploy and staging check, then batch 2 text and buttons [[docs/superpowers/plans/2026-11-01-store-header-hero.md]] [[docs/plan/STORE_SHOPIFY_GAP_AUDIT.md]]
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
