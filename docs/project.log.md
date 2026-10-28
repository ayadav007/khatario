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

## 2026-10-28: Todo create and edit use the session business and user
- **Asked:** "check if the Todo is created correctly", then "yes fix them" for the issues found.
- **Decided:** `/api/todos` list, create and stats, `/api/todos/:id` (GET, PATCH, DELETE) and `/snooze` now use `requireStrictSession`. Business and acting user come from the session only, so body `business_id`, `created_by` and `action_by` are ignored, and a body `business_id` that does not match the session gets a 403. A todo from another business, or an id that is not a UUID, is a 404. Assignees must be active users of the same business. New `lib/todo-input.ts` checks title, dates, enums, channels and related entity, so bad input is a 400 instead of a 500. A missing reminder time now gets the same smart default the Todo page uses (`computeSmartReminderUtc`), not a row with `reminder_type='once'` and no time. The insert or update and its `todo_history` rows run in one transaction. The list stays filtered to the session user, as before. The Todo page's request bodies did not need to change.
- **Shipped:** nothing committed. Files: `app/api/todos/route.ts`, `app/api/todos/[id]/route.ts`, `app/api/todos/[id]/snooze/route.ts`, `app/api/todos/stats/route.ts`, `lib/todo-input.ts`, `tests/security/todos-routes.test.ts` (21 tests).
- **Open:** not exercised against a real DB or staging. `tests/security/branch-update-route.test.ts` has 1 failing test that also fails without these changes.
