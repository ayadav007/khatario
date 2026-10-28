# Khatario project log

Append only. Newest entry at the bottom. Format and rules: [brain.md](brain.md).

## 2026-10-28: Agent memory files
- **Asked:** set up a project log and a roadmap board so agents keep the reasons behind past work, with one front-door file linked from the agent instructions.
- **Decided:** `docs/brain.md` is the front door, linked from `AGENTS.md`. `docs/project.log.md` is append only. `docs/roadmap.md` uses headings as columns and bullets as cards. The existing `docs/BACKLOG.md` stays as the parked-feature detail, and `docs/IMPLEMENTATION-LOG.md` (last updated Aug 2026) becomes read-only history rather than being migrated. Roadmap cards were seeded from recent commits and plan docs, so their order is a first guess for the owner to correct.
- **Shipped:** `docs/brain.md`, `docs/project.log.md`, `docs/roadmap.md`, one line in `AGENTS.md`. Nothing committed.
- **Open:** owner to reorder the Now and Next columns.


## 2026-10-28: Customer-specific prices on the invoice screen
- **Asked:** after a review of party-wise pricing against Tally/Busy/Marg/Vyapar, fix the two invoice-screen bugs (wrong total in "prices include GST" mode, stale price after switching customer), with a test for each.
- **Decided:** party prices are converted to the bill's GST basis exactly like catalog prices, through one helper `lib/invoices/party-price.ts`. Each new line keeps its catalog price and a `partyPriceApplied` flag, so switching to a customer with no party price (or clearing the customer) puts the catalog price back. Lines typed by hand or loaded from saved drafts/estimates are never repriced.
- **Shipped:** `lib/invoices/party-price.ts`, `tests/lib/invoices/party-price.test.ts` (8 tests pass), `app/(app)/invoices/new/page.tsx`. Not checked in the browser. Nothing committed.
- **Open:** bug 3 (a Supplier Hub order's agreed price is replaced by the buyer's saved party price; two separate buyer price lists). Gaps from the review: per-variant prices, sales orders and delivery challans, server-side pricing, price levels, quantity slabs, date ranges, history, discount %, last rate charged, supplier-wise purchase rates, per-unit prices, below-cost warning, and saying the GST basis on the setup screen.
