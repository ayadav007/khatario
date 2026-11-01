# Template designer and gallery redesign

Goal: the template settings should feel like a professional invoice designer (Zoho / Canva-level polish), not a
settings dump. Asked 28 Oct 2026 after a browser review of `/settings/templates` and the customise drawer.

Status: **phases A, B and C built 28 Oct 2026** (not committed), waiting for the owner's review.
Owner's answers: replace the drawer and delete the unused customize page; keep today's paid gating; keep custom hex
colours behind a disclosure; build A, review, then B and C.

Phase A as built: `/settings/templates/design` (`components/templates/designer/`), model and presets in
`lib/template-designer.ts`.
Phase B as built: `source: 'last_document'` on `POST /api/template-preview` (`lib/template-designer-preview.ts`,
`lib/template-preview-source.ts`; the user also needs read access to that document), `data-kh-section` markers in
all templates and three partials with a preview-only bridge script, `POST /api/template-preview/pdf`.
Phase C as built: gallery rewritten (2–4 column grid, line icons, `?doc=` kept in the URL and used by the designer's
Back), thumbnails cached in `.next/cache/template-thumbs` keyed by a hash of template, partials, sample data and
settings (`lib/template-thumbnail-cache.ts`), one shared browser, ETag/304.

## What is wrong today (browser review, 1440×900)

| Area | Problem |
|---|---|
| Drawer shell | 6 tabs in a 420px panel; Layout and Content hidden behind a horizontal scrollbar. Gradient header badge, no save state, Save just greys out |
| Fields tab | 91 checkboxes in one scroll; a different dot and checkbox colour per group; ~20 greyed "Required by GST" rows in the middle |
| Colours | Four hex pickers; "Accent Color" is used by no template |
| Thin tabs | Typography = one dropdown + px slider; Branding = 3 checkboxes; Content = 4 text boxes |
| Preview | Fixed fit-to-panel scale, no zoom, no page count, sample data only, not clickable, Help bubble over the totals |
| Gallery | Thumbnails rendered by headless Chrome per card per view (blank for seconds); `object-cover` shows the middle/bottom of the page; chips over the image; 2 huge cards per row; vanity stats header; 3D emoji doc-type icons |
| Dead code | `app/(app)/settings/templates/customize/page.tsx` (963 lines) is linked from nowhere |

## Target design

### Full-page designer (replaces the drawer)

Route: `/settings/templates/design?template=<id>&doc=<document_type>`. The gallery's "Customise" opens it;
Back returns to the gallery. A full page, so it can be bookmarked, uses the whole screen and has no backdrop.

```
┌ top bar: ← GST Standard  [Tax invoice ▾]        Unsaved changes  ↶ ↷  [Download sample PDF] [Save] ┐
├ left rail 320px ─────────────┬ canvas (grey) ───────────────────────────────────────────────────────┤
│ Style            ▴           │ [Sample data | Last invoice]              Page 1 of 2   [Fit | 100%] │
│   palettes · brand colour    │                                                                     │
│   font · density             │            ┌──────────── A4 paper ────────────┐                     │
│ Header         5 of 8 shown ▾│            │  hover outlines a part;           │                     │
│ Customer and invoice  7/15  ▾│            │  click opens its section ←        │                     │
│ Items table             ▾    │            └───────────────────────────────────┘                     │
│ Totals and tax          ▾    │                                                                     │
│ Footer                  ▾    │                                                                     │
│ Page    A4 · portrait   ▾    │                                                                     │
│ ⓘ GSTIN, HSN, place of supply and signatory always print on tax invoices.                          │
└──────────────────────────────┴─────────────────────────────────────────────────────────────────────┘
```

- **Sections in page order**, collapsible, one open at a time by default. A collapsed section shows a summary
  ("5 of 8 shown", "A4 · portrait · normal margins").
- **Top bar**: template name, document-type switcher (same template's settings for another doc type), save
  state ("Unsaved changes" / "Saved"), undo/redo, Download sample PDF, one primary Save. Ctrl+Z/Y/S and Esc kept;
  leaving with unsaved changes asks first.
- **Phone / narrow screens**: an Edit | Preview switch in the top bar instead of the cramped split.

### Section contents (every existing setting keeps a home)

| Section | Controls |
|---|---|
| Style | 6 curated palettes + "Brand colour" picker (sets primary + table header; header text colour is already computed). "Custom colours" disclosure keeps text and header hex inputs for power users. Font (select showing each font in its own face). Density: Compact / Regular / Roomy (font size 10 / 12 / 13) |
| Header | Logo (upload / replace / remove inline), business name, address, phone, email, website, GSTIN, PAN, CIN, IEC, SWIFT |
| Customer and invoice details | Bill to, ship to, customer fields; invoice number, date, due date, PO, reference, place of supply, reverse charge, e-way bill, delivery note, payment terms, other references, dispatched through, destination, terms of delivery; custom invoice fields placement |
| Items table | Distributor: the column chooser (drag + arrow keys). Other templates: switches for serial, image, HSN, qty, unit, rate, discount %, discount amount, tax rate, tax amount, line total, batch, expiry; custom item fields |
| Totals and tax | Subtotal, discount, additional charges, CGST/SGST/IGST/cess, tax total, round off, grand total, paid, balance, amount in words, HSN-wise summary |
| Footer | Bank details (master switch + fields), terms, notes, payment terms, footer text, signature (link to profile upload), authorised signatory, copy label, QR |
| Export details | Only for the export template / export invoices: currency, exchange rate, ports, incoterms, AWB/BL, declarations |
| Page | Paper size and orientation as segmented controls; margins Narrow / Normal / Wide / Custom (custom reveals the four sliders) |

GST-locked settings (`lockedSettingKeys`) disappear from the lists on GST documents and are summarised in one
note at the bottom of the rail; on quotations and orders they show as normal switches.

### Controls and visual language

- `components/ui/Switch.tsx` instead of checkboxes; one accent colour; no per-group colours or gradients.
- New small primitives: `Segmented`, `ColorSwatches`, `DesignerSection` (accordion row with summary).
- 8px spacing grid, 13px labels, 12px secondary text, sentence case everywhere ("Customise", "Save").
- Paid gating unchanged in substance: Style's font and density, Page, and the footer text boxes show a small
  lock with "Upgrade" instead of whole tabs being disabled.

### Preview canvas

- Grey canvas, paper with a hairline border, zoom Fit / 100% / 150%, "Page 1 of N" from the rendered height.
- **Sample data | Last invoice**: the latest saved document of that type for this business, rendered through
  the real print pipeline with the unsaved settings (new `source: 'last_document'` on `POST /api/template-preview`;
  needs the same settings permission plus read access to that document).
- **Click to edit**: templates mark their parts with `data-kh-section="header|parties|items|totals|footer"`; the
  preview-only screen CSS adds a hover outline and a tiny script posts the clicked section to the designer, which
  opens it. Print and PDF output never carry the script.
- **Download sample PDF**: the same render as the preview, through Puppeteer (new
  `POST /api/template-preview/pdf`).

### Gallery

- 3–4 columns (`minmax(240px,1fr)`), thumbnail showing the top of page 1 (`object-top`), chips under the image,
  name + one-line description, "Active" badge; on hover "Use" and "Customise".
- Line icons (lucide) for document types; stats header removed; sentence case copy.
- **Thumbnail cache**: the image route keeps one browser and caches PNGs on disk
  (`.next/cache/template-thumbs/<template>-<hash of template files + settings>.png`) at 1× scale, so a template is
  rendered once per change, not per view. Cards show a skeleton until loaded.

## Phases

| Phase | Delivers | Backend change |
|---|---|---|
| A | Designer page, sections, switches, palettes, density, margin presets, GST note, top bar with save state, zoom + page count, phone Edit/Preview; gallery "Customise" opens it; drawer and the orphan customize page removed | none |
| B | Last-invoice preview, click-to-edit (`data-kh-section` in all 19 templates), Download sample PDF | preview route option, PDF route |
| C | Gallery grid, thumbnails, icons, copy; thumbnail cache | image route cache |

Saved settings keep the same keys (`show_*`, colours, `font_size`, `margin_*`, `item_columns`), so every existing
customisation keeps working; density and margin presets just write those keys. No migration.

## Tests

- Unit: palette, density and margin presets write the right keys and read back the right preset; the section map
  covers every `show_*` key in `getDefaultTemplateSettings` exactly once (so no control is lost); locked keys are
  hidden on GST documents and shown on orders.
- Render: `data-kh-section` present in preview HTML, absent from PDF HTML; last-document preview uses the
  business's own document only (tenant check).
- Browser (localhost, test DB): each section, save → reload keeps values, undo/redo, zoom, Edit/Preview on phone
  width, gallery loads with cached thumbnails; screenshots for review.

## Decisions for the owner

1. Replace the drawer with the full page, and delete the unused `settings/templates/customize` page?
2. Keep today's paid gating (font, density, page and footer texts paid; colours, fields, branding free)?
3. Keep the hex "Custom colours" option behind a disclosure, or offer palettes + brand colour only?
4. Build A, show you, then B and C, or all three before review?
