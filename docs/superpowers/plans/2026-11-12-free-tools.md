# Free Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Khatario's browser-only tools and a new free GST invoice maker on public `/free-tools` pages, with a home page section and header and footer links, so anyone can use them without an account.

**Architecture:** Each in-app tool's body moves into `components/tools/<Name>Tool.tsx` and is shared by the in-app page (`app/(app)/tools/*`) and one public dynamic route (`app/free-tools/[slug]`). A typed catalogue in `lib/tools/catalogue.ts` drives the hub, the tool pages, the sitemap, public access and the home section. The invoice maker's maths lives in `lib/tools/invoice-maker.ts` and reuses the app's `computeLineGst`.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind, lucide-react, Jest (`npm test`, node environment, only `tests/**/*.test.ts`, `@/` maps to the repo root).

**Spec:** `docs/superpowers/specs/2026-11-12-free-tools-design.md` (read it before starting any task).

## Global Constraints

- Work on `main` in the main checkout. **Do not commit, push or deploy unless the owner asks.** Other sessions' uncommitted work is in this checkout: touch only the files a task names.
- No migrations, no database access, no new npm dependencies, no new API routes.
- Public URLs are `/free-tools` and `/free-tools/<slug>`. `/tools/*` stays the signed-in app's path and keeps working.
- Tool components in `components/tools/` must work signed out: they must not import `@/components/layout/*`, `@/contexts/*`, or call `useAuth`, `useBusiness` or any `/api/` route.
- The invoice maker makes no network request. Its draft lives only in `localStorage`.
- Public page wrappers (hub, tool page, home block) are light theme only: `bg-white`/`bg-slate-50`, `text-slate-*`, `primary-*`, `LANDING_PAGE_GUTTER`; no `dark:` classes in new wrapper files. Classes inside moved tool code stay as they are.
- Every public page sets `metadata` like `app/about/page.tsx`: absolute `title`, `description`, `alternates.canonical`, `openGraph` (`type: 'website'`, `siteName: 'Khatario'`, `images: ['/opengraph-image']`), `twitter` (`summary_large_image`).
- Copy: plain words a shop owner uses, short sentences, sentence-case headings, no em dashes, none of `ISO`, `SOC 2`, `bank-grade`, `military`, `100%`, `unhackable`, `guaranteed`, `best`, `#1`. No copy may state a tax rate except where Task 1 confirmed it.
- Current GST slabs come only from `GST_RATE_SLABS` in `lib/gst/rates.ts` (0, 0.1, 0.25, 1.5, 3, 5, 18, 40).
- Statutory rates on a public page carry: "Rates as of <Month YYYY>. Check the latest notification before filing."
- No local browser run (owner preference). Verification is Jest, `npm run typecheck`, then the staging checklist at the end.
- After the last task run `graphify update .` and append an entry to `docs/project.log.md`.

## Review Focus

1. **A signed-in owner opens `/free-tools/gst-calculator`.** Expected: the public page renders with the marketing header, no redirect to the dashboard or login. Pinned in Task 3.
2. **Odd invoice inputs:** an empty row, a row with quantity 0 or negative, text in a number box, a 0.25 per cent rate, a total in crores. Expected: blank and non-positive rows are ignored, text counts as 0, special rates work, words read correctly. Pinned in Task 5.
3. **A broken or old saved draft** (invalid JSON, a missing field, `localStorage` throwing in a private window). Expected: the maker opens with a fresh draft, never a crash. Pinned in Task 5.
4. **An unknown or withdrawn slug** (`/free-tools/xyz`, or `/free-tools/tds-calculator` if Task 1 keeps TDS private). Expected: a normal 404. Pinned in Task 3 and Task 4.
5. **The in-app tool after the move.** Expected: `/tools/<tool>` shows the same tool with its app header. Pinned in Task 2 by a test that every in-app page renders its shared component.

---

### Task 1: Bring the tools' tax rates up to date

**Files:**
- Create: `lib/tools/gst-quick-rates.ts`, `lib/tools/tds-rates.ts`
- Modify: `app/(app)/tools/gst-calculator/page.tsx` (line 41, `commonRates`), `app/(app)/tools/tds-calculator/page.tsx` (the rate table at the top), `app/(app)/tools/hsn-finder/page.tsx` (the fallback list near line 30), `public/data/hsn_master.json`
- Test: `tests/lib/tools/rates.test.ts`

**Interfaces:**
- Consumes: `GST_RATE_SLABS` from `@/lib/gst/rates`.
- Produces:

```ts
// gst-quick-rates.ts
export const GST_QUICK_RATES: readonly number[]; // [0, 5, 18, 40]
// tds-rates.ts
export type TdsRate = { section: string; oldSection?: string; label: string; rate: number; category: string };
export const TDS_RATES: TdsRate[];
export const TDS_RATES_SOURCE: { url: string; checkedOn: string /* YYYY-MM-DD */ };
export const TDS_PUBLIC: boolean; // false when the table could not be confirmed from an official source
export const RATES_CHECKED_ON: string; // 'YYYY-MM', used in the "Rates as of" line
```

- [ ] **Step 1: Write the failing test**

```ts
it('offers only current GST slabs as quick picks', () => {
  expect([...GST_QUICK_RATES]).toEqual([0, 5, 18, 40]);
  for (const r of GST_QUICK_RATES) expect(GST_RATE_SLABS as readonly number[]).toContain(r);
});
it('gives every HSN entry a current slab or no rate', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/hsn_master.json'), 'utf8'));
  for (const row of rows) {
    expect(row.code).toMatch(/^\d{4,8}$/);
    if (row.rate !== '' && row.rate != null) expect(GST_RATE_SLABS as readonly number[]).toContain(Number(row.rate));
  }
});
it('has a dated, sourced TDS table with no old rates', () => {
  expect(TDS_RATES_SOURCE.url).toMatch(/^https:\/\/(www\.)?incometax(india)?\.gov\.in\//);
  expect(TDS_RATES_SOURCE.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  for (const r of TDS_RATES) { expect(Number.isFinite(r.rate)).toBe(true); expect(r.section.trim()).not.toBe(''); }
  const commission = TDS_RATES.find((r) => /commission|brokerage/i.test(r.label) && !/insurance/i.test(r.label));
  if (TDS_PUBLIC) expect(commission?.rate).toBe(2);
});
it('records when the rates were checked', () => expect(RATES_CHECKED_ON).toMatch(/^\d{4}-\d{2}$/));
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx jest tests/lib/tools/rates.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: GST quick picks.** Create `gst-quick-rates.ts`; the GST calculator imports `GST_QUICK_RATES` in place of `commonRates`. Its custom rate box stays.

- [ ] **Step 4: HSN rates.** For each of the 20 codes in `hsn_master.json` and each entry in the page's fallback list, find the current rate in the CBIC rate notifications effective 22 September 2025 (cbic-gst.gov.in). Use the web search and fetch tools; read the official page, not a blog. Where an item's rate depends on value (for example garments by sale price), set the rate to `""` and add the condition to `desc` only if the official text states it plainly. Where the rate cannot be confirmed, set `""`. The page shows "Check the current rate on the GST portal" for an empty rate. In your report, list every code with its old rate, new rate and the URL that proves it.

- [ ] **Step 5: TDS table.** Rebuild `TDS_RATES` from the Income Tax Department's current TDS rate chart (incometaxindia.gov.in or incometax.gov.in). Show the current section (Income-tax Act, 2025 numbering if in force for payments from 1 April 2026) in `section` and the old 1961 section in `oldSection`. Set `TDS_RATES_SOURCE` to the page used and the date read. If you cannot confirm the table from an official page, keep the existing table inside the app unchanged, set `TDS_PUBLIC = false`, and say so in your report. The TDS calculator page imports `TDS_RATES`, shows `section` with `oldSection` in brackets, and keeps its custom rate option.

- [ ] **Step 6: Run the test and the type check**

Run: `npx jest tests/lib/tools/rates.test.ts && npm run typecheck`
Expected: PASS.

---

### Task 2: Move each tool into a shared component

**Files:**
- Create: `components/tools/` with one file per tool: `GstCalculatorTool.tsx`, `GstinValidatorTool.tsx`, `PanValidatorTool.tsx`, `HsnFinderTool.tsx`, `TdsCalculatorTool.tsx`, `DiscountCalculatorTool.tsx`, `PriceMarginCalculatorTool.tsx`, `InterestCalculatorTool.tsx`, `EmiCalculatorTool.tsx`, `CurrencyConverterTool.tsx`, `InvoiceNumberGeneratorTool.tsx`, `ImageSizeReducerTool.tsx`, `ImageBackgroundRemoverTool.tsx`
- Modify: the 13 matching `app/(app)/tools/<slug>/page.tsx`
- Test: `tests/lib/tools/shared-components.test.ts`

**Interfaces:**
- Consumes: Task 1's rate modules (already used by the pages).
- Produces: each file default-exports nothing and named-exports `export function <Name>Tool(): JSX.Element` (`'use client'`). The in-app page is `PageHeader` (unchanged title, subtitle and actions) followed by `<Name>Tool />`.

- [ ] **Step 1: Write the failing test** (reads source files as text; Jest here cannot render `.tsx`)

```ts
const TOOLS: [slug: string, component: string][] = [
  ['gst-calculator', 'GstCalculatorTool'], ['gstin-validator', 'GstinValidatorTool'], ['pan-validator', 'PanValidatorTool'],
  ['hsn-finder', 'HsnFinderTool'], ['tds-calculator', 'TdsCalculatorTool'], ['discount-calculator', 'DiscountCalculatorTool'],
  ['price-margin-calculator', 'PriceMarginCalculatorTool'], ['interest-calculator', 'InterestCalculatorTool'],
  ['emi-calculator', 'EmiCalculatorTool'], ['currency-converter', 'CurrencyConverterTool'],
  ['invoice-number-generator', 'InvoiceNumberGeneratorTool'], ['image-size-reducer', 'ImageSizeReducerTool'],
  ['image-background-remover', 'ImageBackgroundRemoverTool'],
];
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
it.each(TOOLS)('%s: in-app page renders the shared component', (slug, name) => {
  const page = read(`app/(app)/tools/${slug}/page.tsx`);
  expect(page).toContain(`from '@/components/tools/${name}'`);
  expect(page).toContain(`<${name} />`);
  expect(page).toContain('PageHeader');
});
it.each(TOOLS)('%s: shared component works signed out', (_slug, name) => {
  const src = read(`components/tools/${name}.tsx`);
  expect(src.startsWith("'use client'")).toBe(true);
  expect(src).toContain(`export function ${name}(`);
  expect(src).not.toMatch(/@\/components\/layout\/|@\/contexts\/|useAuth|useBusiness|fetch\(\s*['"`]\/api\//);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx jest tests/lib/tools/shared-components.test.ts`
Expected: FAIL, files missing.

- [ ] **Step 3: Move each tool.** Cut everything in the page except the `PageHeader` block (and the outer wrapper `div`) into the component file: state, helpers, constants, JSX. Keep the in-app page's outer `max-w-*` wrapper in the page. Keep `export const dynamic = 'force-dynamic'` in the in-app page. Do not change behaviour, copy or classes, apart from `HsnFinderTool`: remove its `business` use, or make it optional so the component needs no signed-in business; report what it was used for.

- [ ] **Step 4: Run the test and the type check**

Run: `npx jest tests/lib/tools && npm run typecheck`
Expected: PASS.

---

### Task 3: Tool catalogue, public access and sitemap

**Files:**
- Create: `lib/tools/catalogue.ts`, `components/tools/registry.tsx`
- Modify: `lib/marketing/static-paths.ts`, `app/sitemap.ts`, `lib/auth/public-surfaces.ts`, `middleware.ts` (`isPublicPath`, near line 144)
- Test: `tests/lib/tools/catalogue.test.ts`, `tests/lib/auth/public-surfaces.test.ts` (extend), `tests/lib/marketing/static-paths.test.ts` (extend)

**Interfaces:**
- Consumes: `TDS_PUBLIC` (Task 1); the 13 components (Task 2).
- Produces:

```ts
export type ToolCategory = 'GST and tax' | 'Money' | 'Business' | 'Images';
export type ToolFaq = { question: string; answer: string };
export type FreeTool = {
  slug: string; title: string; shortDescription: string; icon: string /* lucide icon name */;
  category: ToolCategory; metaTitle: string; metaDescription: string;
  howItWorks: string[] /* 2 to 4 sentences */; faqs: ToolFaq[] /* 2 or 3 */; related: string[] /* 2 or 3 slugs */;
  showsStatutoryRates: boolean; notes?: string /* e.g. Google model, approximate rates */;
};
export const FREE_TOOLS: FreeTool[];            // invoice-maker first, then the 13 (tds-calculator only if TDS_PUBLIC)
export function getFreeTool(slug: string): FreeTool | undefined;
export const FREE_TOOL_PATHS: string[];         // '/free-tools' and '/free-tools/<slug>' for each tool
// registry.tsx ('use client')
export const TOOL_COMPONENTS: Record<string, React.ComponentType>; // slug -> next/dynamic component, ssr: false for the two image tools
```

The `invoice-maker` entry is in the catalogue from this task; its registry entry points at `components/tools/InvoiceMakerTool.tsx`, which Task 6 creates. Until then, the registry entry for `invoice-maker` is omitted and the test below skips it by name; Task 6 adds it.

- [ ] **Step 1: Write the failing tests**

```ts
// catalogue.test.ts
it('has unique slugs and valid links between tools', () => {
  const slugs = FREE_TOOLS.map((t) => t.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
  expect(slugs[0]).toBe('invoice-maker');
  for (const t of FREE_TOOLS) {
    for (const r of t.related) { expect(slugs).toContain(r); expect(r).not.toBe(t.slug); }
    expect(t.faqs.length).toBeGreaterThanOrEqual(2); expect(t.faqs.length).toBeLessThanOrEqual(3);
    expect(t.howItWorks.length).toBeGreaterThanOrEqual(2); expect(t.howItWorks.length).toBeLessThanOrEqual(4);
  }
});
it('keeps account-only tools and withdrawn TDS out', () => {
  const slugs = FREE_TOOLS.map((t) => t.slug);
  for (const s of ['todo', 'google-lead-extractor', 'whatsapp-group-extractor']) expect(slugs).not.toContain(s);
  expect(slugs.includes('tds-calculator')).toBe(TDS_PUBLIC);
  expect(getFreeTool('xyz')).toBeUndefined();
});
it('has clean public copy', () => {
  const text = JSON.stringify(FREE_TOOLS);
  expect(text).not.toMatch(/—|\bISO\b|SOC ?2|bank[- ]grade|military|100%|unhackable|guaranteed|\bbest\b|#1/i);
  expect(text).not.toMatch(/\b(12|28)\s?(%|per ?cent)/i);
});
it('marks the rate tools and names the outside model', () => {
  for (const s of ['gst-calculator', 'hsn-finder']) expect(getFreeTool(s)!.showsStatutoryRates).toBe(true);
  expect(getFreeTool('image-background-remover')!.notes).toMatch(/Google/);
  expect(getFreeTool('currency-converter')!.notes).toMatch(/approximate/i);
});
it('lists the hub and every tool page', () => {
  expect(FREE_TOOL_PATHS[0]).toBe('/free-tools');
  expect(FREE_TOOL_PATHS).toHaveLength(FREE_TOOLS.length + 1);
});

// public-surfaces.test.ts (add)
it('keeps free tools public and nothing else', () => {
  const host = 'staging.khatario.com';
  for (const p of ['/free-tools', '/free-tools/', '/free-tools/gst-calculator', '/free-tools/invoice-maker'])
    expect(isPublicMarketingSurface(p, host)).toBe(true);
  for (const p of ['/free-toolsx', '/tools', '/tools/gst-calculator']) expect(isPublicMarketingSurface(p, host)).toBe(false);
});

// static-paths.test.ts (add)
it('lists the free tools hub', () => expect(MARKETING_STATIC_PATHS).toContain('/free-tools'));
```

The existing "has a page file for every path" test in `static-paths.test.ts` will fail for `/free-tools` until Task 4. Leave it.

- [ ] **Step 2: Run them and see them fail**

Run: `npx jest tests/lib/tools/catalogue.test.ts tests/lib/auth/public-surfaces.test.ts tests/lib/marketing/static-paths.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the catalogue.** Titles from the in-app tools list (`app/(app)/tools/page.tsx`), reworded for visitors where needed. `metaTitle` pattern: `Free <Title> | Khatario` (under 60 characters). `metaDescription` under 155 characters. The copy describes only what the tool does today: read each tool's code before writing its `howItWorks` and FAQs. Categories: GST and tax = invoice maker, GST calculator, GSTIN validator, PAN validator, HSN finder, TDS calculator; Money = EMI, interest, discount, price and margin, currency converter; Business = invoice number generator; Images = image size reducer, background remover. `showsStatutoryRates` is true for GST calculator, HSN finder and TDS calculator.

- [ ] **Step 4: Access and sitemap.** `public-surfaces.ts`: public when the path, with one trailing slash removed, is `/free-tools` or starts with `/free-tools/`. `middleware.ts` `isPublicPath`: add `if (pathname === '/free-tools' || pathname.startsWith('/free-tools/')) return true;` beside the `/themes` line. `MARKETING_STATIC_PATHS` gains `/free-tools`. `app/sitemap.ts` adds one entry per tool page from `FREE_TOOLS` (weekly, priority 0.6), like the theme pages.

- [ ] **Step 5: Run the tests and the type check**

Run: `npx jest tests/lib/tools tests/lib/auth tests/lib/marketing && npm run typecheck`
Expected: PASS except the known "has a page file for every path" failure for `/free-tools`.

---

### Task 4: Public hub and tool pages

**Files:**
- Create: `lib/tools/tool-page-seo.ts`, `app/free-tools/page.tsx`, `app/free-tools/[slug]/page.tsx`, `components/tools/FreeToolPageBody.tsx`
- Test: `tests/lib/tools/tool-page-seo.test.ts`

**Interfaces:**
- Consumes: `FREE_TOOLS`, `getFreeTool`, `TOOL_COMPONENTS` (Task 3); `RATES_CHECKED_ON` (Task 1); `MarketingPageShell` (`components/marketing/MarketingPageShell.tsx`: `title`, `intro?`, `eyebrow?`, `children`); `khatarioOrganizationJsonLd`; `publicSiteUrl` from `@/lib/blog/site`.
- Produces:

```ts
export function toolPageMetadata(tool: FreeTool): Metadata;              // canonical /free-tools/<slug>
export function toolPageJsonLd(tool: FreeTool, site: string): Record<string, unknown>; // @graph: SoftwareApplication + FAQPage + BreadcrumbList
export function hubJsonLd(tools: FreeTool[], site: string): Record<string, unknown>;   // CollectionPage with ItemList
export function ratesAsOfLine(checkedOn: string): string; // '2026-11' -> 'Rates as of November 2026. Check the latest notification before filing.'
```

- [ ] **Step 1: Write the failing test**

```ts
const site = 'https://khatario.com';
const gst = getFreeTool('gst-calculator')!;
it('builds metadata with the tool canonical', () => {
  const m = toolPageMetadata(gst);
  expect(m.alternates?.canonical).toBe('/free-tools/gst-calculator');
  expect((m.title as { absolute: string }).absolute).toBe(gst.metaTitle);
  expect(m.description).toBe(gst.metaDescription);
});
it('builds tool JSON-LD as a free app with FAQs and breadcrumbs', () => {
  const ld = toolPageJsonLd(gst, site) as { '@graph': Record<string, any>[] };
  const app = ld['@graph'].find((n) => n['@type'] === 'SoftwareApplication')!;
  expect(app.offers).toMatchObject({ '@type': 'Offer', price: '0', priceCurrency: 'INR' });
  expect(app.url).toBe('https://khatario.com/free-tools/gst-calculator');
  expect(ld['@graph'].find((n) => n['@type'] === 'FAQPage')!.mainEntity).toHaveLength(gst.faqs.length);
  expect(ld['@graph'].find((n) => n['@type'] === 'BreadcrumbList')!.itemListElement).toHaveLength(2);
});
it('lists every tool on the hub', () => {
  const ld = hubJsonLd(FREE_TOOLS, site) as any;
  expect(ld.mainEntity.itemListElement).toHaveLength(FREE_TOOLS.length);
});
it('writes the rates line', () => {
  expect(ratesAsOfLine('2026-11')).toBe('Rates as of November 2026. Check the latest notification before filing.');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx jest tests/lib/tools/tool-page-seo.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `tool-page-seo.ts`.** Metadata fields follow Global Constraints.

- [ ] **Step 4: Hub page `app/free-tools/page.tsx`.** Title `Free Business Tools for Indian Shops | Khatario`; description `Free GST calculator, invoice maker, GSTIN and PAN checker, HSN finder, EMI and margin calculators. No sign-up needed.`; canonical `/free-tools`. `MarketingPageShell` title "Free business tools", intro "Free calculators and checkers for Indian shops. No sign-up needed." Cards grouped by category in the order of `ToolCategory`, each card the icon, title, short description and a link to the tool. A closing block with "Start free" (`/signup`) using the button classes of `app/about/page.tsx`. JSON-LD script from `hubJsonLd` plus the organisation node.

- [ ] **Step 5: Tool page `app/free-tools/[slug]/page.tsx`** (server). `export const dynamicParams = false`; `generateStaticParams` from `FREE_TOOLS`; `generateMetadata` from `toolPageMetadata`; `notFound()` when `getFreeTool` returns undefined. Renders `MarketingSiteHeader`, `<main>` with a breadcrumb (Free tools link, then the tool), `h1` = title, `shortDescription`, `<FreeToolPageBody slug>`, then (light sections) "How it works", the rates line when `showsStatutoryRates`, `notes` when set, the FAQs as `h3` and paragraph pairs, related tool cards, and the call to action "Do this inside Khatario with your own bills" with a "Start free" button to `/signup`. `LandingFooter` last. JSON-LD script from `toolPageJsonLd`.

- [ ] **Step 6: `FreeToolPageBody`** (`'use client'`): looks up `TOOL_COMPONENTS[slug]` and renders it inside a white card wrapper; renders nothing if missing.

- [ ] **Step 7: Run tests and the type check**

Run: `npx jest tests/lib/tools tests/lib/marketing tests/lib/auth && npm run typecheck`
Expected: PASS, including "has a page file for every path".

---

### Task 5: Invoice maker maths and draft

**Files:**
- Create: `lib/tools/invoice-maker.ts`
- Test: `tests/lib/tools/invoice-maker.test.ts`

**Interfaces:**
- Consumes: `computeLineGst`, `round2` from `@/lib/invoices/line-gst`; `GST_RATE_SLABS` from `@/lib/gst/rates`.
- Produces:

```ts
export type InvoiceParty = { name: string; address: string; gstin: string; state: string; phone?: string };
export type InvoiceLine = { description: string; hsn: string; quantity: string; rate: string; discountPercent: string; gstRate: number };
export type InvoiceDraft = {
  seller: InvoiceParty; buyer: InvoiceParty; number: string; date: string /* YYYY-MM-DD */; dueDate: string;
  pricesIncludeGst: boolean; lines: InvoiceLine[]; notes: string;
};
export type InvoiceTotals = {
  intraState: boolean;
  lines: { index: number; taxable: number; cgst: number; sgst: number; igst: number; lineTotal: number }[];
  taxable: number; cgst: number; sgst: number; igst: number; roundOff: number; total: number; totalInWords: string;
};
export const INVOICE_DRAFT_KEY = 'khatario-free-invoice-draft-v1';
export function emptyInvoiceDraft(today: string): InvoiceDraft; // number 'INV-001', one empty line at 18
export function calculateInvoice(draft: InvoiceDraft): InvoiceTotals;
export function amountInWords(rupees: number): string;           // whole rupees, Indian numbering
export function parseInvoiceDraft(raw: string | null, today: string): InvoiceDraft; // never throws
```

- [ ] **Step 1: Write the failing test**

```ts
const today = '2026-11-12';
const draft = (over: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  ...emptyInvoiceDraft(today),
  seller: { name: 'A', address: '', gstin: '', state: 'Madhya Pradesh' },
  buyer: { name: 'B', address: '', gstin: '', state: 'Madhya Pradesh' },
  lines: [{ description: 'Rice', hsn: '1006', quantity: '2', rate: '100', discountPercent: '', gstRate: 5 }],
  ...over,
});
it('splits CGST and SGST within a state', () => {
  const t = calculateInvoice(draft());
  expect(t.intraState).toBe(true);
  expect(t).toMatchObject({ taxable: 200, cgst: 5, sgst: 5, igst: 0, total: 210, roundOff: 0 });
});
it('uses IGST across states, and same-state when the buyer has no state', () => {
  expect(calculateInvoice(draft({ buyer: { name: 'B', address: '', gstin: '', state: 'Gujarat' } }))).toMatchObject({ intraState: false, igst: 10, cgst: 0 });
  expect(calculateInvoice(draft({ buyer: { name: 'B', address: '', gstin: '', state: '' } })).intraState).toBe(true);
});
it('agrees with the app for inclusive prices and discounts', () => {
  const line = { description: 'X', hsn: '', quantity: '3', rate: '118', discountPercent: '10', gstRate: 18 };
  const t = calculateInvoice(draft({ pricesIncludeGst: true, lines: [line] }));
  const app = computeLineGst({ quantity: 3, unit_price: 118, discount_percent: 10, tax_rate: 18 }, true, false, true);
  expect(t.lines[0]).toMatchObject({ taxable: app.taxable, cgst: app.cgst, sgst: app.sgst, lineTotal: app.lineTotal });
});
it('rounds the total to the rupee with a round-off line', () => {
  const t = calculateInvoice(draft({ lines: [{ description: 'Y', hsn: '', quantity: '1', rate: '99.7', discountPercent: '', gstRate: 0 }] }));
  expect(t.total).toBe(100); expect(t.roundOff).toBe(0.3);
});
it('ignores blank, zero and negative rows and treats text as zero', () => {
  const lines = [
    { description: '', hsn: '', quantity: '', rate: '', discountPercent: '', gstRate: 18 },
    { description: 'Z', hsn: '', quantity: '0', rate: '50', discountPercent: '', gstRate: 18 },
    { description: 'N', hsn: '', quantity: '-2', rate: '50', discountPercent: '', gstRate: 18 },
    { description: 'T', hsn: '', quantity: 'abc', rate: '50', discountPercent: '', gstRate: 18 },
    { description: 'Ok', hsn: '', quantity: '1', rate: '100', discountPercent: '', gstRate: 0.25 },
  ];
  const t = calculateInvoice(draft({ lines }));
  expect(t.lines.map((l) => l.index)).toEqual([4]);
  expect(t.taxable).toBe(100);
  expect(t.cgst + t.sgst).toBe(0.26); // 0.13 + 0.13, each head rounded to paise as in the app
});
it('writes amounts in Indian words', () => {
  expect(amountInWords(125450)).toBe('One lakh twenty-five thousand four hundred fifty rupees only');
  expect(amountInWords(23456789)).toBe('Two crore thirty-four lakh fifty-six thousand seven hundred eighty-nine rupees only');
  expect(amountInWords(0)).toBe('Zero rupees only');
  expect(amountInWords(101)).toBe('One hundred one rupees only');
});
it('restores a fresh draft from broken storage', () => {
  expect(parseInvoiceDraft(null, today)).toEqual(emptyInvoiceDraft(today));
  expect(parseInvoiceDraft('{not json', today)).toEqual(emptyInvoiceDraft(today));
  expect(parseInvoiceDraft(JSON.stringify({ number: 'X-9' }), today).number).toBe('X-9');
  expect(parseInvoiceDraft(JSON.stringify({ number: 'X-9' }), today).lines).toHaveLength(1);
  const bad = parseInvoiceDraft(JSON.stringify({ lines: [{ gstRate: 12 }] }), today);
  expect(GST_RATE_SLABS as readonly number[]).toContain(bad.lines[0].gstRate); // unknown rate falls back to 18
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx jest tests/lib/tools/invoice-maker.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `invoice-maker.ts`.** A line counts when `quantity > 0` after `Number()` (NaN is 0); `rate` and `discountPercent` parse the same way. Each counted line goes through `computeLineGst(..., intraState, false, draft.pricesIncludeGst)`. Head totals are sums of the line heads, each passed through `round2`. `total = Math.round(sum of lineTotal)`; `roundOff = round2(total - sum)`. `intraState` is true when the buyer's state is blank or equals the seller's state (trimmed, case-insensitive). `parseInvoiceDraft` merges known fields over `emptyInvoiceDraft`, keeps strings as strings, replaces a `gstRate` not in `GST_RATE_SLABS` with 18, and returns the empty draft on any parse error.

- [ ] **Step 4: Run the test**

Run: `npx jest tests/lib/tools/invoice-maker.test.ts`
Expected: PASS.

---

### Task 6: Invoice maker screen and print

**Files:**
- Create: `components/tools/InvoiceMakerTool.tsx`, `components/tools/InvoicePreview.tsx`
- Modify: `components/tools/registry.tsx` (add `invoice-maker`), `app/globals.css` (print rules, scoped)
- Test: `tests/lib/tools/shared-components.test.ts` (extend)

**Interfaces:**
- Consumes: everything in Task 5's Interfaces; the GSTIN format check used by `GstinValidatorTool` (export it from that component's file or move it to `lib/tools/gstin.ts`, then use it in both).
- Produces: `export function InvoiceMakerTool(): JSX.Element`; `export function InvoicePreview(props: { draft: InvoiceDraft; totals: InvoiceTotals }): JSX.Element`.

- [ ] **Step 1: Extend the test**

```ts
it('invoice maker sends nothing and saves only in this browser', () => {
  const src = read('components/tools/InvoiceMakerTool.tsx') + read('components/tools/InvoicePreview.tsx');
  expect(src).not.toMatch(/fetch\(|axios|XMLHttpRequest|navigator\.sendBeacon|@\/components\/layout\/|useAuth/);
  expect(src).toContain('INVOICE_DRAFT_KEY');
  expect(src).toMatch(/try\s*\{[^}]*localStorage/s);
  expect(src).toContain('window.print()');
  expect(read('components/tools/registry.tsx')).toContain("'invoice-maker'");
});
it('prints only the invoice', () => {
  const css = read('app/globals.css');
  expect(css).toMatch(/@media print[\s\S]*\.free-invoice-print-area/);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx jest tests/lib/tools/shared-components.test.ts`
Expected: FAIL.

- [ ] **Step 3: Build `InvoiceMakerTool`.** Two columns on desktop (form, preview), stacked on phone (form first, then preview, then the button). Form fields as in the spec's inputs; state select lists Indian states and union territories (reuse an existing list if `lib/` has one; search for one before adding a new constant). GSTIN boxes show a soft "This GSTIN does not look right" hint from the format check and never block. Items: add row, remove row (at least one row stays), GST rate select from `GST_RATE_SLABS` showing `x%`. "Prices include GST" switch. Buttons: "Download PDF" (calls `window.print()`), with the line "Choose 'Save as PDF' in the print window." beneath, and "Clear" (confirm, then empty draft). Draft: read once on mount with `parseInvoiceDraft(localStorage.getItem(INVOICE_DRAFT_KEY), today)` inside try/catch; write on change (debounced about 500 ms) inside try/catch.

- [ ] **Step 4: Build `InvoicePreview`.** A4-proportioned white sheet, class `free-invoice-print-area`. Title "Tax Invoice" when the seller has a GSTIN, else "Invoice". Seller block, buyer block with place of supply, number and dates, item table (No., Description, HSN/SAC, Qty, Rate, Disc %, Taxable, GST %, Amount), tax summary (CGST and SGST rows, or IGST), Round off, Total, amount in words, notes, and the footer "Made with Khatario free invoice maker". Money shown with `toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })` and a ₹ sign. Blank optional fields render nothing.

- [ ] **Step 5: Print rules in `app/globals.css`.** Inside `@media print`: when the body contains `.free-invoice-print-area`, hide everything else (`body * { visibility: hidden }`, `.free-invoice-print-area, .free-invoice-print-area * { visibility: visible }`, position the area at the top left, full width), `@page { size: A4; margin: 12mm; }`. Scope every rule with `.free-invoice-print-area` or `:has(.free-invoice-print-area)` so no other page's printing changes.

- [ ] **Step 6: Run the tests and the type check**

Run: `npx jest tests/lib/tools && npm run typecheck`
Expected: PASS.

---

### Task 7: Home page section, header and footer links

**Files:**
- Create: `components/marketing/landing/LandingFreeTools.tsx`
- Modify: `lib/marketing-builder/block-types.ts` (`KHATARIO_BLOCKS`), `components/marketing/builder/config.tsx` (new `FreeTools` entry next to `AiTools`, around line 1070), `lib/marketing-builder/default-home.ts` (`HOME_SECTIONS`, after `'AiTools'`), `components/marketing/landing/LandingPage.tsx` (`LandingDefaultSections`, after `<LandingAiTools />`), `components/marketing/MarketingSiteHeader.tsx` (`RESOURCE_LINKS`, line 103), `lib/marketing/footer-links.ts` (Learn column)
- Test: `tests/lib/marketing/free-tools-section.test.ts`, `tests/lib/marketing/footer-links.test.ts` (extend)

**Interfaces:**
- Consumes: `FREE_TOOLS`, `getFreeTool` (Task 3).
- Produces:

```ts
export type LandingFreeToolsContent = { heading: string; intro: string; toolSlugs: { slug: string }[] };
export const LANDING_FREE_TOOLS_DEFAULTS: LandingFreeToolsContent;
// heading 'Free tools for your shop'; intro 'Calculators, checkers and an invoice maker. Free, no sign-up.';
// toolSlugs: invoice-maker, gst-calculator, gstin-validator, hsn-finder, emi-calculator, price-margin-calculator
export function LandingFreeTools(props?: Partial<LandingFreeToolsContent>): JSX.Element;
export function resolveFreeToolCards(slugs: { slug: string }[]): FreeTool[]; // unknown slugs dropped, at most 6
```

Put `LANDING_FREE_TOOLS_DEFAULTS` and `resolveFreeToolCards` in `lib/marketing/free-tools-section.ts` so they are testable; the component file imports them.

- [ ] **Step 1: Write the failing tests**

```ts
// free-tools-section.test.ts
it('defaults to six real tools', () => {
  const cards = resolveFreeToolCards(LANDING_FREE_TOOLS_DEFAULTS.toolSlugs);
  expect(cards.map((c) => c.slug)).toEqual(['invoice-maker', 'gst-calculator', 'gstin-validator', 'hsn-finder', 'emi-calculator', 'price-margin-calculator']);
});
it('drops unknown slugs and caps at six', () => {
  const many = FREE_TOOLS.map((t) => ({ slug: t.slug }));
  expect(resolveFreeToolCards([{ slug: 'nope' }, ...many])).toHaveLength(6);
  expect(resolveFreeToolCards([{ slug: 'nope' }])).toEqual([]);
});
it('is a Site Builder block on the default home page after AiTools', () => {
  expect(KHATARIO_BLOCKS).toContain('FreeTools');
  const i = HOME_SECTIONS.indexOf('AiTools');
  expect(HOME_SECTIONS[i + 1]).toBe('FreeTools');
});

// footer-links.test.ts (add)
it('links the free tools hub', () => {
  expect(FOOTER_COLUMNS.find((c) => c.title === 'Learn')!.links).toContainEqual({ label: 'Free tools', href: '/free-tools' });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx jest tests/lib/marketing/free-tools-section.test.ts tests/lib/marketing/footer-links.test.ts`
Expected: FAIL.

- [ ] **Step 3: Build the section.** `LandingFreeTools` (server-safe, no client hooks): `id="free-tools"`, light background, heading and intro via the section-head pattern other landing sections use (`LandingSectionHead` if it fits), a grid of up to six cards (icon, title, short description, link to `/free-tools/<slug>`), and a "See all free tools" link to `/free-tools`. Builder config: label "Free tools", fields `heading` (text), `intro` (area), `toolSlugs` (list of `{ slug: text('Tool slug') }`, max 6), `defaultProps: LANDING_FREE_TOOLS_DEFAULTS`, `render: renderAs(LandingFreeTools)`. Add `'FreeTools'` to `KHATARIO_BLOCKS` and after `'AiTools'` in `HOME_SECTIONS`, and `<LandingFreeTools />` after `<LandingAiTools />`.

- [ ] **Step 4: Links.** Header `RESOURCE_LINKS` gains, first, `{ label: 'Free tools', text: 'GST calculator, invoice maker and more', icon: Wrench, href: '/free-tools' }` (import `Wrench` from lucide-react); the mobile menu already maps `RESOURCE_LINKS`. Footer Learn column gains `{ label: 'Free tools', href: '/free-tools' }` after Guides.

- [ ] **Step 5: Run the tests and the type check**

Run: `npx jest tests/lib/marketing tests/lib/marketing-builder tests/lib/tools && npm run typecheck`
Expected: PASS.

---

### Task 8: Whole-change checks and hand-over

**Files:**
- Modify: `docs/project.log.md` (append), `docs/roadmap.md` (card)

- [ ] **Step 1: Run everything**

Run: `npx jest tests/lib/tools tests/lib/marketing tests/lib/marketing-builder tests/lib/auth` then `npm run typecheck`
Expected: all pass.

- [ ] **Step 2: Leftover search**

Run: `grep -rn "commonRates = \[0, 5, 12, 18, 28\]" app components` and `grep -rln "from '@/components/layout/" components/tools`
Expected: no matches.

- [ ] **Step 3:** `graphify update .`

- [ ] **Step 4:** Append the project log entry (rates checked with their sources, TDS public or not, HSN codes left without a rate) and update the roadmap card.

## Staging checklist (after deploy to `https://staging.khatario.com`)

1. Signed out, open `/free-tools`: every tool card opens its page; each page has the tool, How it works, questions, related tools and Start free.
2. Signed in to a business, open `/free-tools/gst-calculator`: the public page shows, no redirect.
3. In the app, open each `/tools/<tool>` from the Tools menu: same tool as before, with its app header.
4. GST calculator quick picks are 0, 5, 18 and 40.
5. HSN finder: search "rice" and "t-shirt"; an entry with no confirmed rate says to check the GST portal.
6. TDS calculator: if public, sections show the new number with the old one in brackets and the "Rates as of" line.
7. Invoice maker, both states the same: CGST and SGST rows; change the customer's state: one IGST row; totals match a hand calculation.
8. Invoice maker: switch "Prices include GST" on with a discount; the line total stays the price quoted.
9. Download PDF on desktop Chrome and Android Chrome: the print window shows only the invoice on A4; save as PDF and open it.
10. Refresh the invoice maker: the draft comes back; Clear empties it. In a private window the page still works.
11. Background remover loads its model and cuts out a photo; image size reducer shrinks a photo.
12. `/free-tools/xyz` shows the 404 page.
13. `/sitemap.xml` lists `/free-tools` and every tool page.
14. Header Resources menu and footer Learn column link to `/free-tools`.
15. In `/admin/site-builder`, add the Free tools block below Khatario AI, publish, and check the home page shows six cards and "See all free tools".

## Owner actions

1. After deploy, add the Free tools block to the published home page in the Site Builder and publish.
2. Optionally remove the "Made with Khatario free invoice maker" footer line.
