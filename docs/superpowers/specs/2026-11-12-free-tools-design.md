# Free tools on khatario.com: design

Date: 2026-11-12. Part of phase 3 ("search pages") of the missing marketing pages work; the trust pages (phase 1) shipped the same day.

## Why

Billing software sites rank and win sign-ups with free tools that work without an account (GST calculator, invoice generator, HSN finder). Khatario already has 13 such tools, but they live inside the signed-in app at `/tools/*`, so visitors and search engines cannot reach them.

## Goal and success

Anyone can open `khatario.com/free-tools`, pick a tool and use it without signing in. The home page shows a "Free tools" section. A new free invoice maker lets a visitor make a GST invoice and save it as a PDF.

Done means:
- `/free-tools` and one page per tool exist, open signed out, and are in the sitemap.
- Each public tool behaves exactly as its in-app version, because both use the same component.
- The invoice maker sends nothing to Khatario and its totals are correct for intra-state and inter-state GST.
- The home page section exists as a Site Builder block and in the default section list; header and footer link to `/free-tools`.
- Unit tests pass; a staging checklist is written.

## Decisions made by the owner

- First release: the 13 existing browser-only tools plus a new free invoice maker.
- The invoice maker asks for nothing before download; nothing the visitor types is sent to Khatario.
- Design approved as presented: `/free-tools` URLs, shared tool components, browser print for the PDF.

## Tools in this release

| Slug (public URL `/free-tools/<slug>`) | In-app source today | Notes |
|---|---|---|
| `gst-calculator` | `app/(app)/tools/gst-calculator` | Quick-pick rates updated to the current slabs (see below) |
| `gstin-validator` | `gstin-validator` | Format and check-digit only; page says it does not check the GST portal |
| `pan-validator` | `pan-validator` | uses `lib/tools/pan-validator.ts` |
| `hsn-finder` | `hsn-finder` | 20 common codes from `public/data/hsn_master.json`; page says "common codes". Its `business` lookup is dropped or made optional so it works signed out |
| `tds-calculator` | `tds-calculator` | Public only after its rate table is rebuilt from an official source (see below) |
| `discount-calculator` | `discount-calculator` | |
| `price-margin-calculator` | `price-margin-calculator` | |
| `interest-calculator` | `interest-calculator` | |
| `emi-calculator` | `emi-calculator` | |
| `currency-converter` | `currency-converter` | Fixed approximate rates (`lib/tools/currency-converter.ts`); page keeps saying so |
| `invoice-number-generator` | `invoice-number-generator` | |
| `image-size-reducer` | `image-size-reducer` | Runs in the browser; no upload |
| `image-background-remover` | `image-background-remover` | Loads Google's MediaPipe model from `storage.googleapis.com`; page says so |
| `invoice-maker` | new | See below |

Not public (need an account or the server): `todo`, `google-lead-extractor`, `whatsapp-group-extractor`.

## Statutory rates must be current before a tool goes public

Three tools carry built-in tax rates that are out of date, and a public page must not show wrong tax figures:
- **GST calculator** quick-pick rates are `[0, 5, 12, 18, 28]`. Since 22 September 2025 the slabs are those in `lib/gst/rates.ts` (`GST_RATE_SLABS`: 0, 0.1, 0.25, 1.5, 3, 5, 18, 40; 28 only for tobacco and pan masala). The quick picks become 0, 5, 18 and 40, with the custom rate box kept for special rates. This also fixes the in-app version.
- **HSN finder** data (`public/data/hsn_master.json` and the fallback list in the page) still shows 12 per cent on several codes. Every code's rate is checked against the current CBIC rate notification. A code whose current rate cannot be confirmed is shown with no rate and the line "Check the current rate on the GST portal". The build report lists the source used for each code.
- **TDS calculator** rates and section names are out of date (for example 194H commission and 194D insurance commission are 2 per cent now, the e-commerce entry should be 194-O at 0.1 per cent, and the Income-tax Act, 2025 renumbers sections from 1 April 2026). Its table is rebuilt from the Income Tax Department's current TDS rate chart, showing the current section with the old section number in brackets, with the source and its date recorded in a code comment. If the table cannot be confirmed from an official source, the TDS calculator stays out of the public release (it remains in the app) and the hub does not list it.

Each tool page that shows statutory rates carries the line "Rates as of <month year>. Check the latest notification before filing." with the date the table was checked.

## Approach

- **Public URLs under `/free-tools`.** `/tools/*` stays the signed-in app's path. Root URLs such as `/gst-calculator` are rejected because they can collide with business slugs (`app/(public-business)/[slug]`).
- **One component per tool.** Each in-app page's body (everything below its `PageHeader`) moves into `components/tools/<Name>Tool.tsx`. The in-app page becomes its `PageHeader` plus that component; the public page wraps the same component in the marketing shell. The tool code moves; its behaviour does not change.
- **One catalogue.** `lib/tools/catalogue.ts` lists every public tool: `slug`, `title`, `shortDescription`, `icon` name, `category` (`GST and tax`, `Money`, `Business`, `Images`), page `metaTitle` and `metaDescription`, a two-to-four-sentence `howItWorks`, two or three `faqs`, and `related` slugs. The hub, the home section, the sitemap, the public-path check and the tests all read it.

## Pages

### `/free-tools` (hub)

Marketing header and footer (`MarketingPageShell` from the trust pages). Title "Free business tools", a one-line intro ("Free calculators and checkers for Indian shops. No sign-up needed."), tool cards grouped by category, then a closing "Start free" call to action. Metadata like `/about`; canonical `/free-tools`; JSON-LD `CollectionPage` listing the tools.

### `/free-tools/<slug>` (one per tool)

One dynamic route, `app/free-tools/[slug]/page.tsx`, with `generateStaticParams` from the catalogue and `notFound()` for unknown slugs. A small client map (`components/tools/registry.tsx`) maps slug to the tool component, loaded with `next/dynamic` so each page only ships its own tool.

Layout: breadcrumb (Free tools > Tool), `h1` = tool title, the tool, "How it works", the FAQs (with `FAQPage` JSON-LD), related tool cards, and one call to action: "Do this inside Khatario with your own bills: Start free" linking `/signup`. Metadata from the catalogue; canonical `/free-tools/<slug>`; `SoftwareApplication` JSON-LD (`applicationCategory: BusinessApplication`, `offers.price: 0`).

The tool components keep their own light styling. Any `dark:` classes inside them stay (the in-app version uses them); public pages render on a white background.

### Free invoice maker (`/free-tools/invoice-maker`)

New component `components/tools/InvoiceMakerTool.tsx` with its maths in `lib/tools/invoice-maker.ts`.

Inputs:
- Your business: name, address, GSTIN (optional, checked with the GSTIN validator's format check), state, phone.
- Customer: name, address, GSTIN (optional), state.
- Invoice: number (default `INV-001`), date (today), due date (optional).
- Items: description, HSN/SAC (optional), quantity, rate, discount per cent (optional), GST rate chosen from `GST_RATE_SLABS` in `lib/gst/rates.ts` (default 18), with add and remove rows.
- "Prices include GST" switch (off by default).
- Notes (optional).

Rules:
- Place of supply is the customer's state. Same state as the business: CGST and SGST. Different state: IGST. No customer state: treated as same state.
- Each line is worked out with `computeLineGst` from `lib/invoices/line-gst.ts`, the same function the app uses for real invoices (pure, no database), so free and paid invoices agree to the paisa.
- The invoice total is rounded to the nearest rupee with a "Round off" line, as in the app.
- Amount in words in Indian numbering (lakh, crore).

Output: a live preview in one clean Khatario-styled layout, and a "Download PDF" button that calls `window.print()` with a print stylesheet that prints only the invoice (A4, no header, footer or form). A short line under the button says "Choose 'Save as PDF' in the print window."

Storage: the draft is saved in `localStorage` under one key and restored on load, wrapped in try/catch; "Clear" empties it. Nothing is sent to any server; the component makes no network request.

The invoice carries a small footer line "Made with Khatario free invoice maker" (owner can remove later).

## Home page and navigation

- New Site Builder block `FreeTools` (`components/marketing/landing/LandingFreeTools.tsx`): heading "Free tools for your shop", subheading "Calculators, checkers and an invoice maker. Free, no sign-up.", six tool cards (invoice maker, GST calculator, GSTIN validator, HSN finder, EMI calculator, price and margin calculator), and a "See all free tools" link. Heading, subheading and the six slugs are editable props with these defaults.
- Added to `KHATARIO_BLOCKS`, the builder config, `HOME_SECTIONS` (after `AiTools`) and `LandingDefaultSections`.
- The live home page is a published Site Builder document, so the owner adds the block in `/admin/site-builder` and publishes. Nothing writes to the published document automatically.
- Header: "Free tools" in the resources menu and the mobile menu. Footer: "Free tools" in the Learn column.

## Access and search

- `middleware.ts` `PUBLIC_PATHS` matches exact paths, so `/free-tools` and every `/free-tools/<slug>` from the catalogue are added (or a `/free-tools/` prefix check is added beside the exact set, whichever the existing code supports without changing other paths' behaviour).
- `lib/auth/public-surfaces.ts`: `/free-tools` and paths under `/free-tools/` are public.
- Sitemap: `/free-tools` and each tool page, from the catalogue.
- `MARKETING_STATIC_PATHS` gains `/free-tools`; the footer-links test keeps every footer link pointing at a real page.

## Out of scope

- A full HSN/SAC list (the database table is not exposed publicly).
- Live currency rates.
- Khatario bill designs or server-made PDFs in the invoice maker.
- Carrying a free invoice into a new account at sign-up.
- New tools other than the invoice maker.
- Hindi or other language versions.

## Testing

Unit tests (Jest, node, `tests/lib/tools/` and `tests/lib/marketing/`):
- GST calculator quick picks equal 0, 5, 18, 40 and include neither 12 nor 28.
- HSN data: every entry's rate is a current slab from `GST_RATE_SLABS` or is empty.
- TDS table (if public): every rate is a number, every entry names a current section, and the source date is present.
- `invoice-maker.ts`: line amounts, CGST/SGST split for same state, IGST for different states, no-state treated as same state, round-off line, amount in words (for example 1,25,450 → "One lakh twenty-five thousand four hundred fifty rupees only"), empty and zero-quantity rows ignored.
- Catalogue: unique slugs, every slug has a registry entry and an in-app or new component file, `related` slugs exist, no FAQ or text contains a banned claim word or an em dash, every tool has 2 or 3 FAQs.
- Access: every catalogue path is public in `public-surfaces`; `/free-toolsx` and `/tools/gst-calculator` are not made public.
- Sitemap list includes the hub and every tool.

The moved tools are covered by the type check and the staging checklist; their logic is not rewritten.

Staging checklist (in the plan): each tool page signed out and signed in, the in-app `/tools/*` pages still work, invoice maker intra-state and inter-state totals, PDF via print on desktop Chrome and Android Chrome, draft restored after refresh, background remover loads its model, home section after adding the block in the Site Builder.

## Owner steps

1. After deploy, add the Free tools block to the home page in `/admin/site-builder` and publish.
2. Optionally remove the "Made with Khatario free invoice maker" footer line.
