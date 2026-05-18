# Form layout pattern (Zoho-style bands)

Use this on long settings and entity forms. Reference implementations:

- `components/ui/FormSection.tsx` — shared section panel
- `components/ui/FormPageScaffold.tsx` — `FormPageContainer`, `FormCard` (optional convenience), re-exports `FormSection`
- `app/globals.css` — tokens as utility classes (see below)

**Modernised (banded layout):** `items/new`, `customers/new`, `customers/[id]/edit`, `suppliers/new`, `purchases/new` (desktop form only — mobile step wizard unchanged), `settings/warehouses/new`, `settings/branches/new`, `settings/warehouses/[id]/edit`, `settings/branches/[id]/edit`, `stock-transfers/new`, `stock-transfers/[id]/receive`, `accounts/new`.

**Still on legacy layouts** (same shell pattern to apply when you touch them): `employees/new`, `journal-entries/new`, `credit-notes/new`, `debit-notes/new`, `purchase-returns/new`, and most settings pages that use bare `space-y-4` forms (`settings/users`, `settings/shifts`, TDS, expenses, payments in/out, `invoices/new`, etc.). Auth/admin/marketing pages (`login`, `signup`) can stay visually distinct unless you want consistency there too.

## Single source of truth

| What | Where |
|------|--------|
| Section panel chrome (border, radius, header/background colors, title/description typography) | **`FormSection`** component + **`.form-section-*`** classes in `app/globals.css` |
| Full-width stack spacing between sections | **`.form-page-shell`** in `app/globals.css` (`w-full max-w-none space-y-6`) |

Edit **`globals.css`** (inside `@layer components`) if you need to change header tint, title colour, or body background for **all** forms at once.

## Page shell

- Page outer wrapper: `className="w-full min-w-0 max-w-none"` (matches item/customer pages).
- Card: `className="p-6 sm:p-8 lg:p-10"`.
- Inside the `<form>`, wrap all sections in:

```html
<div className="form-page-shell">
  <FormSection title="…" description="…">…</FormSection>
</div>
```

- Actions (Cancel / Save): separate row below with `pt-4 mt-6 border-t border-border` (or similar).

## Convenience wrappers (optional)

```tsx
import { FormPageContainer, FormCard, FormSection } from '@/components/ui/FormPageScaffold';
```

- **`FormPageContainer`** — `w-full min-w-0 max-w-none` outer column.
- **`FormCard`** — `Card` with `p-6 sm:p-8 lg:p-10` for the form container.

## Section component

```tsx
import { FormSection } from '@/components/ui/FormSection';
// or: import { FormSection } from '@/components/ui/FormPageScaffold';
```

- Optional `className` on `FormSection` merges into the outer `<section>` if you need one-off tweaks.

## Field grids (per section)

- Default: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 gap-y-6`.
- Full-width row in that grid: `sm:col-span-2 lg:col-span-3` (or `lg:col-span-2` where appropriate).
- Avoid page-level `md:col-span-*` grids that span unrelated sections.

## Width caps

- Long inputs / tool blocks: `max-w-3xl` where readability matters.

## Checklist for new screens

1. Use **`form-page-shell`** + **`FormSection`** — do not duplicate section markup.
2. One **logical topic** per `FormSection` with title + optional description.
3. Internal grids per section only.
4. Prefer adjusting **globals** for global colour/spacing changes.
