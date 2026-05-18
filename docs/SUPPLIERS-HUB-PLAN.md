# Suppliers Hub — product & implementation plan

This document captures the **Suppliers Hub** direction: opt-in directory discovery, connection requests, curated published listings, and ordering that reuses the existing `suppliers` + `linked_business_id` model.

## Principles

1. **One supplier graph** — Directory “add” only creates or advances a normal buyer-side `suppliers` row with `linked_business_id`; no parallel marketplace entity.
2. **Discovery ≠ automatic trade** — Connect (request → accept) before treating the relationship as active for linked-only catalog.
3. **Narrow listings first** — Published rows are a curated subset of the supplier’s `items`, not a full ERP sync.

## Phases (roadmap)

| Phase | Scope | Status |
|-------|--------|--------|
| A | DB: `business_discovery`, `supplier_connection_requests`, `supplier_published_listings`; notification types | **MVP shipped (migration 178)** |
| B | APIs: discovery, directory search, public profile, connection CRUD, listings CRUD | **MVP shipped** |
| C | UI: `/suppliers/hub`, profile page, `/settings/suppliers-directory` | **MVP shipped** |
| D | Hybrid ordering: “from listing” + “off catalog” wired to quantity request / PO | Partial — use existing purchase request flows + supplier id |
| E | Trust: admin `directory_approved`, verification badges, rate limits, `link_only` tokens | **directory_approved** column ready; UI/admin optional |

## Visibility levels

| Level | Directory search | Profile (authenticated) |
|-------|------------------|-------------------------|
| `hidden` | No | No |
| `directory` | Yes (if `directory_approved`) | Yes |
| `link_only` | No | Yes (direct URL; share with buyers) |

## MVP implementation notes (codebase)

- **Migration:** `database/migrations/178_suppliers_hub_discovery.sql`
- **Settings:** `app/(app)/settings/suppliers-directory/page.tsx` — opt-in + manage listings
- **Hub:** `app/(app)/suppliers/hub/page.tsx`, `app/(app)/suppliers/hub/[businessId]/page.tsx`
- **APIs:** under `app/api/suppliers/hub/`

## Acceptance / ops

- Run migration **178** on each environment.
- Optional: set `directory_approved = false` by default in DB and flip trusted businesses via SQL until an admin UI exists.

## Related docs

- `docs/IMPLEMENTATION-LOG.md` — session changelog
