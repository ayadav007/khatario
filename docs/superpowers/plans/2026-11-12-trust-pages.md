# Trust Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give khatario.com real Contact, Refund policy, Privacy, Terms, Pricing and Security pages, linked from the marketing footer and the sitemap.

**Architecture:** Static Next.js server pages in the pattern of `app/about/page.tsx`. All text and facts live as typed data in `lib/marketing/**` (testable under Jest's node environment); pages and two small components only lay that data out. `/pricing` reuses the home page's `LandingPricing` with the live plan catalogue.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind, lucide-react, Jest (`npm test`, node environment, `tests/**/*.test.ts` only, `@/` maps to the repo root).

**Spec:** `docs/superpowers/specs/2026-11-12-trust-pages-design.md` (read it before starting any task).

## Global Constraints

- Work on `main` in the main checkout. **Do not commit, push or deploy unless the owner asks.** Each task ends by listing its files; if the owner has asked for commits, stage those files by name (never `git add .`).
- No migrations, no new npm dependencies, no new API routes.
- Marketing pages are light theme only: `bg-white`/`bg-slate-50`, `text-slate-*`, `primary-*` accents, `LANDING_PAGE_GUTTER` from `@/lib/marketing-layout`. No `dark:` classes.
- A blank company fact renders nothing: no empty label, no invented value, no "undefined".
- Refund rule, verbatim: full refund when asked within **7 days** of a business's **first payment**; **no refund on renewals**; cancel any time and the plan runs to the end of the paid period. Approved refunds reach the original payment method in **5 to 7 working days**.
- Grievance line, verbatim values: complaints are acknowledged within **48 hours** and resolved within **15 days**.
- No page text states a plan price or plan limit. Numbers come only from the live catalogue.
- No certification or superlative claim anywhere: none of `ISO`, `SOC 2`, `SOC2`, `bank-grade`, `bank grade`, `military`, `100% secure`, `unhackable`, `guaranteed` (the legal texts may use "guarantee" only in a disclaimer, such as "we do not guarantee uninterrupted service").
- Copy style: plain words a shop owner uses, short sentences, sentence-case headings, no em dashes.
- Every page sets `metadata` like `/about`: absolute `title`, `description`, `alternates.canonical`, `openGraph` (`type: 'website'`, `siteName: 'Khatario'`, `images: ['/opengraph-image']`), `twitter` (`summary_large_image`).
- No local browser run (owner preference). Verification is Jest, `npm run typecheck`, `npm run lint`, then the staging checklist at the end.
- After the last task run `graphify update .` and append an entry to `docs/project.log.md`.

## Review Focus

1. **Facts that are blank in disguise or unsafe:** whitespace-only values, an `http://` or `javascript:` social link, a phone with spaces and dashes. Expected: hidden, or cleaned into a valid `tel:` link. Pinned in Task 1.
2. **Legal text with every fact blank:** expected to read as normal sentences naming "Khatario", with no `undefined`, `null`, empty brackets or double spaces. Pinned in Tasks 3, 4 and 5 by running each document with blank and with filled facts.
3. **Near-miss paths and a signed-in visitor:** `/pricing` and `/pricing/` are public; `/pricing-admin`, `/security-settings` and `/contacts` (an app page) are not. Pinned in Task 2.
4. **Plan catalogue fails to load on `/pricing`:** expected to render with the built-in fallback plans, not an error page. Pinned in Task 7.
5. **A footer link to a page that does not exist:** expected never to ship. Pinned in Task 9 by checking every footer path against the list of real pages.

---

### Task 1: Company facts and organisation data

**Files:**
- Create: `lib/marketing/company-facts.ts`
- Modify: `lib/marketing/brand-structured-data.ts`
- Test: `tests/lib/marketing/company-facts.test.ts`, `tests/lib/marketing/brand-structured-data.test.ts`

**Interfaces:**
- Produces:

```ts
export type SocialNetwork = 'instagram' | 'youtube' | 'facebook' | 'linkedin' | 'x';
export type CompanyFacts = {
  legalName: string; registeredAddress: string; phone: string; gstin: string;
  grievanceOfficerName: string; grievanceEmail: string; jurisdictionCity: string;
  social: Record<SocialNetwork, string>;
};
export type CompanyFactName = Exclude<keyof CompanyFacts, 'social'>;
export type SocialLink = { network: SocialNetwork; url: string };

export const BLANK_COMPANY_FACTS: CompanyFacts;      // every field ''
export const KHATARIO_COMPANY_FACTS: CompanyFacts;   // every field '' until the owner fills it
export function fact(name: CompanyFactName, facts?: CompanyFacts): string | null; // trimmed, '' -> null
export function companyName(facts?: CompanyFacts): string;       // legalName, else 'Khatario'
export function addressLines(facts?: CompanyFacts): string[];    // split on newlines, trimmed, blanks dropped
export function telHref(phone: string): string | null;           // 'tel:+919812345678', null when under 8 digits
export function socialLinks(facts?: CompanyFacts): SocialLink[]; // fixed order: instagram, youtube, facebook, linkedin, x
// brand-structured-data.ts
export function khatarioOrganizationJsonLd(site: string, facts?: CompanyFacts): Record<string, unknown>;
```

`facts` defaults to `KHATARIO_COMPANY_FACTS` everywhere. Put a comment above `KHATARIO_COMPANY_FACTS` telling the owner what each field is and that a blank hides it.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/marketing/company-facts.test.ts
const filled: CompanyFacts = {
  ...BLANK_COMPANY_FACTS,
  legalName: '  Khatario Tech Pvt Ltd ', registeredAddress: '12 MG Road\n\n  Indore 452001 \nMadhya Pradesh',
  phone: '+91 98123-45678',
  social: { instagram: 'https://instagram.com/khatario', youtube: 'http://youtube.com/@k', facebook: 'javascript:alert(1)', linkedin: '   ', x: 'https://x.com/khatario' },
};
it('returns null for blank and whitespace-only facts', () => {
  expect(fact('legalName', BLANK_COMPANY_FACTS)).toBeNull();
  expect(fact('gstin', { ...BLANK_COMPANY_FACTS, gstin: '   ' })).toBeNull();
  expect(fact('legalName', filled)).toBe('Khatario Tech Pvt Ltd');
});
it('falls back to the brand name', () => {
  expect(companyName(BLANK_COMPANY_FACTS)).toBe('Khatario');
  expect(companyName(filled)).toBe('Khatario Tech Pvt Ltd');
});
it('splits the address into clean lines', () => {
  expect(addressLines(filled)).toEqual(['12 MG Road', 'Indore 452001', 'Madhya Pradesh']);
  expect(addressLines(BLANK_COMPANY_FACTS)).toEqual([]);
});
it('builds a tel link from a formatted phone', () => {
  expect(telHref('+91 98123-45678')).toBe('tel:+919812345678');
  expect(telHref('098123 45678')).toBe('tel:09812345678');
  expect(telHref('')).toBeNull();
  expect(telHref('12345')).toBeNull();
});
it('keeps only https social links, in a fixed order', () => {
  expect(socialLinks(filled)).toEqual([
    { network: 'instagram', url: 'https://instagram.com/khatario' },
    { network: 'x', url: 'https://x.com/khatario' },
  ]);
  expect(socialLinks(BLANK_COMPANY_FACTS)).toEqual([]);
});
it('ships with every fact blank until the owner fills it', () => {
  expect(KHATARIO_COMPANY_FACTS).toEqual(BLANK_COMPANY_FACTS);
});
```

Delete the last test in the same change in which the owner's real values are entered.

```ts
// tests/lib/marketing/brand-structured-data.test.ts
const site = 'https://khatario.com';
it('omits legal name, phone, address and sameAs when facts are blank', () => {
  const org = khatarioOrganizationJsonLd(site, BLANK_COMPANY_FACTS);
  for (const key of ['legalName', 'telephone', 'address', 'sameAs']) expect(org).not.toHaveProperty(key);
  expect(org['@id']).toBe('https://khatario.com/#organization');
});
it('adds them when facts are set', () => {
  const org = khatarioOrganizationJsonLd(site, filled); // same `filled` as above
  expect(org.legalName).toBe('Khatario Tech Pvt Ltd');
  expect(org.telephone).toBe('+919812345678');
  expect(org.address).toEqual({ '@type': 'PostalAddress', streetAddress: '12 MG Road, Indore 452001, Madhya Pradesh', addressCountry: 'IN' });
  expect(org.sameAs).toEqual(['https://instagram.com/khatario', 'https://x.com/khatario']);
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npx jest tests/lib/marketing/company-facts.test.ts tests/lib/marketing/brand-structured-data.test.ts`
Expected: FAIL, cannot find module `@/lib/marketing/company-facts`.

- [ ] **Step 3: Implement `lib/marketing/company-facts.ts`** with the signatures above. A social link is kept only when `new URL(value)` parses and its protocol is `https:`.

- [ ] **Step 4: Extend `khatarioOrganizationJsonLd`** with the optional `facts` parameter. `sameAs` is `KHATARIO_PROFILE_URLS` followed by `socialLinks(facts)` URLs, de-duplicated, omitted when empty. `telephone` is the `telHref` value without `tel:`. Existing callers (`app/page.tsx`, `app/about/page.tsx`) stay unchanged.

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/lib/marketing`
Expected: PASS.

---

### Task 2: Public access and sitemap for the new paths

**Files:**
- Create: `lib/marketing/static-paths.ts`
- Modify: `app/sitemap.ts` (replace the local `STATIC_PATHS` constant, line 10), `lib/auth/public-surfaces.ts`, `middleware.ts` (`PUBLIC_PATHS`, near line 75)
- Test: `tests/lib/marketing/static-paths.test.ts`, `tests/lib/auth/public-surfaces.test.ts` (extend)

**Interfaces:**
- Produces:

```ts
/** Marketing pages listed in the sitemap. Add a path here when its page ships. */
export const MARKETING_STATIC_PATHS: readonly string[];
// '/', '/about', '/blog', '/guides', '/themes', '/privacy', '/terms', '/book-demo',
// '/solution/accounting', '/solution/inventory', '/contact', '/pricing', '/refund-policy', '/security'
export const TRUST_PAGE_PATHS: readonly string[]; // '/contact', '/pricing', '/refund-policy', '/security'
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/marketing/static-paths.test.ts
it('lists the four trust pages and keeps the old ones', () => {
  for (const p of ['/contact', '/pricing', '/refund-policy', '/security', '/privacy', '/terms', '/about', '/'])
    expect(MARKETING_STATIC_PATHS).toContain(p);
  expect(new Set(MARKETING_STATIC_PATHS).size).toBe(MARKETING_STATIC_PATHS.length);
});
it('has a page file for every path', () => {
  for (const p of MARKETING_STATIC_PATHS)
    expect(fs.existsSync(path.join(process.cwd(), 'app', p, 'page.tsx'))).toBe(true);
});

// tests/lib/auth/public-surfaces.test.ts (add)
it('keeps the trust pages public and near-miss app paths private', () => {
  const host = 'staging.khatario.com';
  for (const p of ['/contact', '/pricing', '/pricing/', '/refund-policy', '/security'])
    expect(isPublicMarketingSurface(p, host)).toBe(true);
  for (const p of ['/contacts', '/pricing-admin', '/security-settings', '/refund-policy-edit', '/invoices'])
    expect(isPublicMarketingSurface(p, host)).toBe(false);
});
```

The "page file for every path" test stays red until Tasks 3, 6, 7 and 8 create the pages. That is intended; it goes green in Task 8.

- [ ] **Step 2: Run and see them fail**

Run: `npx jest tests/lib/marketing/static-paths.test.ts tests/lib/auth/public-surfaces.test.ts`
Expected: FAIL (module missing; `/contact` not public).

- [ ] **Step 3: Implement.** `static-paths.ts` as above. `app/sitemap.ts` imports `MARKETING_STATIC_PATHS` in place of its constant. `public-surfaces.ts` treats a path as public when, with one trailing slash removed, it equals a `TRUST_PAGE_PATHS` entry (exact match, not `startsWith`). Add the four paths to `PUBLIC_PATHS` in `middleware.ts`, and check how `PUBLIC_PATHS` is matched there: if it is an exact `Set.has`, confirm a trailing slash is already normalised by Next before the check, and leave matching logic alone.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/lib/auth/public-surfaces.test.ts tests/lib/marketing/static-paths.test.ts`
Expected: public-surfaces PASS; static-paths passes the first test and fails only "has a page file for every path" for the four new paths.

---

### Task 3: Legal text layout and the Refund policy page

**Files:**
- Create: `lib/marketing/legal/types.ts`, `lib/marketing/legal/links.ts`, `lib/marketing/legal/refund.ts`, `components/marketing/MarketingPageShell.tsx`, `components/marketing/LegalDocument.tsx`, `app/refund-policy/page.tsx`
- Test: `tests/lib/marketing/legal/links.test.ts`, `tests/lib/marketing/legal/refund.test.ts`, helper `tests/lib/marketing/legal/legal-checks.ts`

**Interfaces:**
- Consumes: `CompanyFacts`, `BLANK_COMPANY_FACTS`, `KHATARIO_COMPANY_FACTS`, `companyName` (Task 1); `getPublicSupportConfig()` from `@/lib/marketing-public-config`.
- Produces:

```ts
// types.ts
export type LegalSection = { id: string; heading: string; paragraphs?: string[]; bullets?: string[] };
export type LegalDocumentData = { updatedOn: string; sections: LegalSection[] }; // updatedOn is 'YYYY-MM-DD'
export type LegalContext = { facts: CompanyFacts; supportEmail: string };
export function defaultLegalContext(): LegalContext; // KHATARIO_COMPANY_FACTS + support email ('help@khatario.com' if unset)
export function formatLegalDate(iso: string): string; // '2026-11-12' -> '12 November 2026'
// links.ts
export type LegalTextPart = string | { label: string; href: string };
export function splitLegalLinks(text: string): LegalTextPart[]; // understands [label](href)
// refund.ts
export function refundPolicy(ctx: LegalContext): LegalDocumentData;
// components
export function MarketingPageShell(props: { title: string; intro?: string; eyebrow?: string; children: React.ReactNode }): JSX.Element;
export function LegalDocument(props: { document: LegalDocumentData }): JSX.Element;
// tests helper
export function expectCleanLegalDocument(doc: LegalDocumentData): void;
```

- [ ] **Step 1: Write the failing tests**

```ts
// links.test.ts
it('splits internal and mailto links from text', () => {
  expect(splitLegalLinks('See the [refund policy](/refund-policy) or write to [us](mailto:help@khatario.com).')).toEqual([
    'See the ', { label: 'refund policy', href: '/refund-policy' }, ' or write to ', { label: 'us', href: 'mailto:help@khatario.com' }, '.',
  ]);
});
it('leaves unsafe or external links as plain text', () => {
  for (const t of ['[x](javascript:alert(1))', '[x](https://evil.example)', '[x](//evil.example)'])
    expect(splitLegalLinks(t)).toEqual([t]);
  expect(splitLegalLinks('no links')).toEqual(['no links']);
});

// legal-checks.ts
export function expectCleanLegalDocument(doc: LegalDocumentData) {
  expect(doc.updatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const ids = doc.sections.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const s of doc.sections) {
    expect(s.id).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(s.heading.trim().length).toBeGreaterThan(0);
    const lines = [...(s.paragraphs ?? []), ...(s.bullets ?? [])];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of [s.heading, ...lines]) {
      expect(line).not.toMatch(/undefined|TODO|TBD|being prepared|\(\s*\)|\s{2,}|—/);
      expect(line).not.toMatch(/\bISO\b|SOC ?2|bank[- ]grade|military|100% secure|unhackable/i);
      expect(line.trim()).toBe(line);
    }
  }
}
// Shared by the refund, privacy and terms tests.
export const blank: LegalContext = { facts: BLANK_COMPANY_FACTS, supportEmail: 'help@khatario.com' };
export const filledAll: LegalContext = {
  supportEmail: 'help@khatario.com',
  facts: {
    legalName: 'Khatario Tech Pvt Ltd', registeredAddress: '12 MG Road\nIndore 452001', phone: '+91 98123 45678',
    gstin: '23ABCDE1234F1Z5', grievanceOfficerName: 'Asha Verma', grievanceEmail: 'grievance@khatario.com',
    jurisdictionCity: 'Indore',
    social: { instagram: 'https://instagram.com/khatario', youtube: '', facebook: '', linkedin: '', x: '' },
  },
};

// refund.test.ts
// `blank` and `filledAll` come from ./legal-checks
it('reads cleanly with blank and with filled facts', () => {
  expectCleanLegalDocument(refundPolicy(blank));
  expectCleanLegalDocument(refundPolicy(filledAll));
});
it('states the refund rule', () => {
  const text = JSON.stringify(refundPolicy(blank));
  expect(text).toMatch(/within 7 days/);
  expect(text).toMatch(/first payment/);
  expect(text).toMatch(/renewal/i);
  expect(text).toMatch(/5 to 7 working days/);
  expect(text).toContain('help@khatario.com');
});
it('has the agreed sections in order', () => {
  expect(refundPolicy(blank).sections.map((s) => s.id)).toEqual(
    ['seven-day-refund', 'not-refunded', 'cancelling', 'how-to-ask', 'timing', 'free-plan', 'contact']);
});
it('formats the date', () => expect(formatLegalDate('2026-11-12')).toBe('12 November 2026'));
```

- [ ] **Step 2: Run and see them fail**

Run: `npx jest tests/lib/marketing/legal`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement `types.ts` and `links.ts`.** `splitLegalLinks` accepts an href only when it starts with a single `/` followed by a non-`/` character, or with `mailto:`. `formatLegalDate` must not depend on the server time zone (build the date from the three numbers).

- [ ] **Step 4: Write `refund.ts`** with `updatedOn: '2026-11-12'` and the seven sections, content as the spec's `/refund-policy` section lists: the 7-day rule; what is not refunded (renewals, a first payment older than 7 days, WhatsApp message charges and other usage already consumed, add-on services already delivered); cancelling (in the app under Settings, Subscription, or by writing to support; plan stays active to the end of the paid period); how to ask (email support from the registered phone or email with business name and payment date); timing (5 to 7 working days, original payment method); free plan; contact (support email as a `mailto:` link, link to `/contact`).

- [ ] **Step 5: Build the two components.**
  - `MarketingPageShell` (server component): `<div className="min-h-screen bg-white">`, `MarketingSiteHeader`, `<main>`, a hero section copying the classes of the first `<section>` in `app/about/page.tsx` (lines 72-88: `border-b border-slate-200/80 bg-white pb-14 pt-28 md:pb-16 md:pt-32`, `h1` `text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl`), then `children`, then `LandingFooter`. `eyebrow` renders as the small pill above the title when given.
  - `LegalDocument` (server component): inside `LANDING_PAGE_GUTTER`, a `max-w-3xl` column; "Last updated: {formatLegalDate}"; a contents list of `#id` links; each section as `<section id>` with `scroll-mt-28`, an `h2`, paragraphs and a `<ul>`; text rendered through `splitLegalLinks` (internal links with `next/link`, `mailto:` with `<a>`).

- [ ] **Step 6: Create `app/refund-policy/page.tsx`.** Title `Refund and Cancellation Policy | Khatario`; description `Full refund within 7 days of your first payment on Khatario. How to cancel a plan, what is not refunded and how long a refund takes.`; canonical `/refund-policy`; body `MarketingPageShell` (title "Refund and cancellation policy") around `LegalDocument` with `refundPolicy(defaultLegalContext())`.

- [ ] **Step 7: Run the tests and the type check**

Run: `npx jest tests/lib/marketing/legal && npm run typecheck`
Expected: PASS, no type errors.

---

### Task 4: Privacy policy

**Files:**
- Create: `lib/marketing/legal/privacy.ts`
- Modify: `app/privacy/page.tsx` (replace the whole placeholder)
- Test: `tests/lib/marketing/legal/privacy.test.ts`

**Interfaces:**
- Consumes: `LegalContext`, `LegalDocumentData`, `defaultLegalContext`, `MarketingPageShell`, `LegalDocument`, `expectCleanLegalDocument` (Task 3); `fact`, `companyName`, `addressLines` (Task 1).
- Produces: `export function privacyPolicy(ctx: LegalContext): LegalDocumentData;`

- [ ] **Step 1: Confirm the third parties from the code** and note each finding in a comment at the top of `privacy.ts` as `// <service>: <file that proves it>`. Find: the payment gateway (search `razorpay`), the OTP/SMS and WhatsApp senders (search `otp`, `msg91`, `twilio`, `graph.facebook.com`), AI providers used for bill scanning and Ask Khatario (search `anthropic`, `openai`, `gemini` under `lib/services` and `lib/rag`), analytics and ad pixels (`components/marketing/SignupMetaPixel.tsx`, search `gtag`, `clarity`), email sender (search `nodemailer`, `resend`, `ses`), where staff check-in reads location and device signals (`app/(public-business)/[slug]/employees/attendance`, `phone/`). A service not found in the code is not named in the policy; describe only its category if the category is certain, else leave the line out.

- [ ] **Step 2: Write the failing test**

```ts
it('reads cleanly with blank and with filled facts', () => {
  expectCleanLegalDocument(privacyPolicy(blank));
  expectCleanLegalDocument(privacyPolicy(filledAll)); // `blank`, `filledAll` from ./legal-checks
});
it('has the agreed sections in order', () => {
  expect(privacyPolicy(blank).sections.map((s) => s.id)).toEqual([
    'who-we-are', 'what-we-collect', 'why-we-use-it', 'who-we-share-with', 'your-customers-data',
    'retention-and-deletion', 'your-rights', 'cookies', 'children', 'changes', 'grievance-officer']);
});
it('names the company and officer only when set', () => {
  expect(JSON.stringify(privacyPolicy(blank))).not.toMatch(/Pvt Ltd/);
  const text = JSON.stringify(privacyPolicy(filledAll));
  expect(text).toContain('Khatario Tech Pvt Ltd');
  expect(text).toContain('Asha Verma');            // grievanceOfficerName in filledAll
  expect(text).toContain('grievance@khatario.com'); // grievanceEmail in filledAll
});
it('falls back to the support email for grievances and states the timelines', () => {
  const text = JSON.stringify(privacyPolicy(blank));
  expect(text).toContain('help@khatario.com');
  expect(text).toMatch(/48 hours/);
  expect(text).toMatch(/15 days/);
  expect(text).toMatch(/Digital Personal Data Protection Act, 2023/);
});
```

- [ ] **Step 3: Run and see it fail**

Run: `npx jest tests/lib/marketing/legal/privacy.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 4: Write `privacy.ts`** (`updatedOn: '2026-11-12'`), content per the spec's `/privacy` section, using only what Step 1 confirmed. State plainly: card numbers never reach Khatario; a business owns its customers' data and Khatario processes it for the business; rights are access, correction, erasure and grievance; requests go to the grievance contact.

- [ ] **Step 5: Replace `app/privacy/page.tsx`.** Title `Privacy Policy | Khatario`; description `What data Khatario collects from shops and their customers, why, who it is shared with and how to ask for it to be corrected or deleted.`; canonical `/privacy`; `MarketingPageShell` (title "Privacy policy") + `LegalDocument`. The old "Back to sign up" link and `dark:` classes go.

- [ ] **Step 6: Run the tests and the type check**

Run: `npx jest tests/lib/marketing/legal && npm run typecheck`
Expected: PASS.

---

### Task 5: Terms of service

**Files:**
- Create: `lib/marketing/legal/terms.ts`
- Modify: `app/terms/page.tsx` (replace the whole placeholder)
- Test: `tests/lib/marketing/legal/terms.test.ts`

**Interfaces:**
- Consumes: same as Task 4.
- Produces: `export function termsOfService(ctx: LegalContext): LegalDocumentData;`

- [ ] **Step 1: Write the failing test**

```ts
it('reads cleanly with blank and with filled facts', () => {
  expectCleanLegalDocument(termsOfService(blank));
  expectCleanLegalDocument(termsOfService(filledAll));
});
it('has the agreed sections in order', () => {
  expect(termsOfService(blank).sections.map((s) => s.id)).toEqual([
    'acceptance', 'your-account', 'plans-and-payments', 'refunds', 'acceptable-use', 'your-data',
    'online-store', 'tax-responsibility', 'availability', 'liability', 'suspension', 'governing-law', 'changes', 'contact']);
});
it('links refunds to the refund policy', () => {
  const refunds = termsOfService(blank).sections.find((s) => s.id === 'refunds')!;
  expect(JSON.stringify(refunds)).toContain('](/refund-policy)');
});
it('names a court city only when set', () => {
  const law = (ctx: LegalContext) => JSON.stringify(termsOfService(ctx).sections.find((s) => s.id === 'governing-law'));
  expect(law(blank)).toContain('the courts of India');
  expect(law(filledAll)).toContain('the courts at Indore'); // jurisdictionCity: 'Indore'
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npx jest tests/lib/marketing/legal/terms.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Write `terms.ts`** (`updatedOn: '2026-11-12'`), content per the spec's `/terms` section. Before writing `your-data`, confirm that data export exists at `app/(app)/settings/export`; if it does, say the business can export its data there.

- [ ] **Step 4: Replace `app/terms/page.tsx`.** Title `Terms of Service | Khatario`; description `The terms for using Khatario: your account, plans and payments, acceptable use, your data and our responsibilities.`; canonical `/terms`; shell title "Terms of service".

- [ ] **Step 5: Run the tests and the type check**

Run: `npx jest tests/lib/marketing/legal && npm run typecheck`
Expected: PASS.

---

### Task 6: Contact page

**Files:**
- Create: `lib/marketing/contact-details.ts`, `app/contact/page.tsx`
- Test: `tests/lib/marketing/contact-details.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; `getPublicSupportConfig()`; `MarketingPageShell`; `khatarioOrganizationJsonLd`; `publicSiteUrl` from `@/lib/blog/site`.
- Produces:

```ts
export type SupportConfig = { email: string | null; whatsappUrl: string | null; hours: string };
export type ContactChannel = { kind: 'email' | 'whatsapp' | 'phone'; label: string; value: string; href: string };
export type ContactDetails = {
  channels: ContactChannel[];   // order: email, whatsapp, phone; only those that are set
  hours: string;
  office: { legalName: string | null; addressLines: string[]; gstin: string | null } | null; // null when all three are blank
  grievance: { officerName: string | null; email: string | null };
};
export function getContactDetails(facts: CompanyFacts, support: SupportConfig): ContactDetails;
```

- [ ] **Step 1: Write the failing test**

```ts
const support = { email: 'help@khatario.com', whatsappUrl: null, hours: 'Mon–Sat · 9:00–18:00 IST' };
it('shows only email when nothing else is set, and no office block', () => {
  const d = getContactDetails(BLANK_COMPANY_FACTS, support);
  expect(d.channels).toEqual([{ kind: 'email', label: 'Email', value: 'help@khatario.com', href: 'mailto:help@khatario.com' }]);
  expect(d.office).toBeNull();
  expect(d.grievance).toEqual({ officerName: null, email: 'help@khatario.com' });
});
it('adds WhatsApp and phone when set', () => {
  const d = getContactDetails({ ...BLANK_COMPANY_FACTS, phone: '+91 98123 45678' }, { ...support, whatsappUrl: 'https://wa.me/919812345678' });
  expect(d.channels.map((c) => c.kind)).toEqual(['email', 'whatsapp', 'phone']);
  expect(d.channels[2]).toMatchObject({ value: '+91 98123 45678', href: 'tel:+919812345678' });
});
it('drops a WhatsApp link that is not https and a phone too short to dial', () => {
  const d = getContactDetails({ ...BLANK_COMPANY_FACTS, phone: '123' }, { ...support, whatsappUrl: 'javascript:alert(1)' });
  expect(d.channels.map((c) => c.kind)).toEqual(['email']);
});
it('shows the office block when any one office fact is set', () => {
  const d = getContactDetails({ ...BLANK_COMPANY_FACTS, gstin: '23ABCDE1234F1Z5' }, support);
  expect(d.office).toEqual({ legalName: null, addressLines: [], gstin: '23ABCDE1234F1Z5' });
});
it('prefers the grievance email and survives no email at all', () => {
  expect(getContactDetails({ ...BLANK_COMPANY_FACTS, grievanceEmail: 'grievance@khatario.com', grievanceOfficerName: 'Asha Verma' }, support).grievance)
    .toEqual({ officerName: 'Asha Verma', email: 'grievance@khatario.com' });
  const none = getContactDetails(BLANK_COMPANY_FACTS, { ...support, email: null });
  expect(none.channels).toEqual([]);
  expect(none.grievance.email).toBeNull();
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npx jest tests/lib/marketing/contact-details.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `getContactDetails`.**

- [ ] **Step 4: Create `app/contact/page.tsx`.** Title `Contact Khatario | Support, Sales and Grievance Officer`; description `Reach Khatario support by email or WhatsApp, book a demo, or write to our grievance officer.`; canonical `/contact`. Layout inside `MarketingPageShell` (title "Contact Khatario", intro "Questions about your account, plans or switching from another billing app? Write to us."):
  1. Channel cards (`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm`, grid `sm:grid-cols-2 lg:grid-cols-3`) with lucide icons `Mail`, `MessageCircle`, `Phone`, plus the hours line. When `channels` is empty, show only the Book a demo card.
  2. Two link cards: "Talk to sales" to `/book-demo`, "How-to guides" to `/guides`.
  3. "Registered office" section, rendered only when `office` is not null; each line only when set; GSTIN as "GSTIN: …".
  4. "Grievance officer" section: one sentence that complaints about data or content can be sent to the grievance officer; name when set; email when set; then "We acknowledge complaints within 48 hours and resolve them within 15 days."
  5. JSON-LD `@graph`: `khatarioOrganizationJsonLd(site)` and a `ContactPage` node (`@id` `${site}/contact#webpage`, `about` and `isPartOf` as in `app/about/page.tsx` lines 55-64).

- [ ] **Step 5: Run the tests and the type check**

Run: `npx jest tests/lib/marketing && npm run typecheck`
Expected: PASS (the page-file test in `static-paths.test.ts` still fails for `/pricing` and `/security` only).

---

### Task 7: Pricing page

**Files:**
- Create: `lib/marketing/pricing-page.ts`, `components/marketing/pricing/PricingPageBody.tsx`, `app/pricing/page.tsx`
- Modify: `components/marketing/MarketingSiteHeader.tsx` (lines 391 and 521: `/#pricing` becomes `/pricing`)
- Test: `tests/lib/marketing/pricing-page.test.ts`

**Interfaces:**
- Consumes: `loadPricingCatalog`, `PricingCatalog` from `@/lib/subscription/pricing-catalog`; `LandingPricing`; `LandingProductProvider` and the same `readProductLineFromSearchParam` that `LandingPage.tsx` line 79 uses; `LandingPlansProvider`; `LandingFooter`; `MarketingSiteHeader`.
- Produces:

```ts
export type BillingQuestion = { id: string; question: string; answer: string }; // answer may hold [label](/path) links
export const PRICING_BILLING_QUESTIONS: BillingQuestion[];
export function loadPricingCatalogOrNull(load?: () => Promise<PricingCatalog>): Promise<PricingCatalog | null>;
export function pricingFaqJsonLd(questions: BillingQuestion[]): Record<string, unknown>; // FAQPage, link markup stripped to its label
// client component
export function PricingPageBody(props: { pricingCatalog: PricingCatalog | null }): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

```ts
it('has the six billing questions', () => {
  expect(PRICING_BILLING_QUESTIONS.map((q) => q.id)).toEqual(
    ['free-plan', 'how-to-pay', 'change-plan', 'plan-ends', 'gst-on-price', 'refund']);
});
it('never states a price or a limit in text', () => {
  for (const q of PRICING_BILLING_QUESTIONS) {
    const text = `${q.question} ${q.answer}`.replace('within 7 days', '');
    expect(text).not.toMatch(/₹|Rs\.?|\d/);
    expect(text).not.toMatch(/—|undefined/);
  }
});
it('sends refund questions to the refund policy', () => {
  const refund = PRICING_BILLING_QUESTIONS.find((q) => q.id === 'refund')!;
  expect(refund.answer).toContain('within 7 days');
  expect(refund.answer).toContain('](/refund-policy)');
});
it('returns null when the catalogue fails to load, and the catalogue when it loads', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(loadPricingCatalogOrNull(async () => { throw new Error('db down'); })).resolves.toBeNull();
  const catalog = { plans: [] } as unknown as PricingCatalog;
  await expect(loadPricingCatalogOrNull(async () => catalog)).resolves.toBe(catalog);
  spy.mockRestore();
});
it('builds FAQ data without link markup', () => {
  const ld = pricingFaqJsonLd(PRICING_BILLING_QUESTIONS) as any;
  expect(ld['@type']).toBe('FAQPage');
  expect(ld.mainEntity).toHaveLength(6);
  expect(JSON.stringify(ld)).not.toMatch(/\]\(/);
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npx jest tests/lib/marketing/pricing-page.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `lib/marketing/pricing-page.ts`.** Before writing each answer, confirm it from the code: the free plan and its nature (`lib/subscription/pricing-view.ts`, `lib/landing-pricing-fallback.ts`), the payment methods the gateway integration offers, how a plan change and an expired plan behave (`lib/subscription/lifecycle.ts`, `apply-module-plan-change.ts`), and whether GST is added on top of the shown price (search the checkout code for `gst`/`tax`). An answer that cannot be confirmed says to ask support and links to `/contact`. `loadPricingCatalogOrNull` logs with `console.error('Pricing page plans failed to load:', error)`.

- [ ] **Step 4: Build `PricingPageBody`** (`'use client'`): reads `useSearchParams().get('product')` through `readProductLineFromSearchParam`, then `LandingProductProvider initialProductLine` > `LandingPlansProvider initialCatalog={pricingCatalog}` > `LandingPricing` (no props, as in `LandingPage.tsx` line 56). Do not change `LandingPricing`.

- [ ] **Step 5: Create `app/pricing/page.tsx`** (server component, `export const revalidate = 300`). Title `Khatario Pricing | Free Plan and Paid Plans for Shops`; description `See every Khatario plan for billing, staff and WhatsApp marketing. Start on the free plan and pay when the shop grows.`; canonical `/pricing`. Body: `MarketingSiteHeader`; `<main className="pt-20">` with `PricingPageBody` inside `<Suspense fallback={null}>` (required because it reads search params); a "Billing questions" section (`bg-slate-50 py-14`, `max-w-3xl`, each question an `h3` with its answer rendered through `splitLegalLinks`); a final block with "Start free" (`/signup`) and "Book a demo" (`/book-demo`) buttons using the classes from `app/about/page.tsx` lines 124-138; `LandingFooter`; a JSON-LD script with `pricingFaqJsonLd`. If the pricing section's own heading is an `h2`, add a visually hidden `<h1>` "Khatario pricing" above it so the page has one `h1`.

- [ ] **Step 6: Point the header at the page.** In `MarketingSiteHeader.tsx` change the two `/#pricing` links to `/pricing`. If the header marks the current page for `plainLink`, pass "current" when the path is `/pricing`. Leave `LandingHero.tsx` (`#pricing`), `MagloMarketingPreview.tsx` and `lib/rag/ingest/plans-source.ts` unchanged.

- [ ] **Step 7: Run the tests and the type check**

Run: `npx jest tests/lib/marketing && npm run typecheck`
Expected: PASS except the page-file test for `/security`.

---

### Task 8: Security page

**Files:**
- Create: `lib/marketing/security-claims.ts`, `app/security/page.tsx`
- Test: `tests/lib/marketing/security-claims.test.ts`

**Interfaces:**
- Consumes: `MarketingPageShell`; `getPublicSupportConfig()`.
- Produces:

```ts
export type SecurityClaim = { id: string; title: string; body: string; evidence: string }; // evidence: repo path(s) that prove it; never shown on the page
export const SECURITY_CLAIMS: SecurityClaim[];
```

- [ ] **Step 1: Confirm each candidate claim.** Read `docs/SERVER_INFRASTRUCTURE.md` first. For each row of the spec's `/security` table, find the proof and decide keep or drop:

| id | Keep only if |
|---|---|
| `encrypted-traffic` | the nginx config in the server docs redirects HTTP to HTTPS on production |
| `separate-business-data` | business id comes from the session in API routes (see `tests/security`); say "kept separate", and mention database row-level security only if `2026-11-05-row-level-security-design.md` is applied on production, per `docs/roadmap.md` |
| `login-and-roles` | OTP login and role permissions exist (`tests/pbac`) |
| `backups` | a backup job exists under `app/api/cron/` or in the server docs; state the real frequency found, and say nothing about frequency if none is documented |
| `server-location` | the server docs name the country; otherwise drop the claim |
| `payments` | the gateway integration never receives card numbers (hosted checkout or payment links) |
| `data-export` | `app/(app)/settings/export` works for the business owner |
| `invoice-history` | the invoice history feature (migration 469) is live on production per `docs/project.log.md`; otherwise drop |

Report dropped claims and the reason in the task summary. Fewer than four kept claims: stop and ask the owner before building the page.

- [ ] **Step 2: Write the failing test**

```ts
it('has between four and eight claims with unique ids', () => {
  expect(SECURITY_CLAIMS.length).toBeGreaterThanOrEqual(4);
  expect(SECURITY_CLAIMS.length).toBeLessThanOrEqual(8);
  expect(new Set(SECURITY_CLAIMS.map((c) => c.id)).size).toBe(SECURITY_CLAIMS.length);
});
it('backs every claim with a file that exists', () => {
  for (const c of SECURITY_CLAIMS)
    for (const p of c.evidence.split(',').map((s) => s.trim()))
      expect(fs.existsSync(path.join(process.cwd(), p))).toBe(true);
});
it('makes no certification or absolute claim', () => {
  for (const c of SECURITY_CLAIMS) {
    const text = `${c.title} ${c.body}`;
    expect(text).not.toMatch(/ISO|SOC ?2|bank[- ]grade|military|100%|unhackable|guaranteed|never be (lost|hacked)|—/i);
    expect(text.trim().length).toBeGreaterThan(20);
  }
});
```

- [ ] **Step 3: Run and see it fail**

Run: `npx jest tests/lib/marketing/security-claims.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 4: Write `security-claims.ts`** with the kept claims, each `body` one or two plain sentences, each `evidence` the path(s) from Step 1.

- [ ] **Step 5: Create `app/security/page.tsx`.** Title `How Khatario Keeps Your Data Safe`; description `How Khatario protects your shop's bills, customers and accounts: encrypted connections, separate data for every business, backups and data export.` (remove from the description any item whose claim was dropped); canonical `/security`. `MarketingPageShell` (title "How Khatario keeps your data safe"), a grid of claim cards (same card classes as Task 6), then "Report a security problem" with the support email as a `mailto:` link and a link to `/privacy`.

- [ ] **Step 6: Run the tests and the type check**

Run: `npx jest tests/lib/marketing tests/lib/auth/public-surfaces.test.ts && npm run typecheck`
Expected: all PASS, including "has a page file for every path".

---

### Task 9: Footer links, contact line and social icons

**Files:**
- Create: `lib/marketing/footer-links.ts`
- Modify: `components/marketing/landing/LandingFooter.tsx`
- Test: `tests/lib/marketing/footer-links.test.ts`

**Interfaces:**
- Consumes: `MARKETING_STATIC_PATHS` (Task 2); `socialLinks`, `fact`, `telHref`, `companyName` (Task 1); `getPublicSupportConfig()`.
- Produces:

```ts
export type FooterLink = { label: string; href: string };
export const FOOTER_COLUMNS: { title: string; links: FooterLink[] }[];
export const FOOTER_LEGAL_LINKS: FooterLink[];
```

- [ ] **Step 1: Write the failing test**

```ts
const OTHER_REAL_PAGES = ['/login', '/signup', '/partners']; // exist, deliberately not in the sitemap list
const all = [...FOOTER_COLUMNS.flatMap((c) => c.links), ...FOOTER_LEGAL_LINKS];
it('links only to pages that exist', () => {
  for (const l of all) {
    const pathOnly = l.href.split(/[?#]/)[0] || '/';
    expect([...MARKETING_STATIC_PATHS, ...OTHER_REAL_PAGES]).toContain(pathOnly);
  }
});
it('carries the trust pages', () => {
  const hrefs = all.map((l) => l.href);
  for (const p of ['/contact', '/pricing', '/refund-policy', '/security', '/privacy', '/terms']) expect(hrefs).toContain(p);
  expect(hrefs).not.toContain('/#pricing');
});
it('orders the legal row', () => {
  expect(FOOTER_LEGAL_LINKS).toEqual([
    { label: 'Privacy', href: '/privacy' }, { label: 'Terms', href: '/terms' },
    { label: 'Refund policy', href: '/refund-policy' }, { label: 'Security', href: '/security' }]);
});
it('has no duplicate labels inside a column', () => {
  for (const c of FOOTER_COLUMNS) expect(new Set(c.links.map((l) => l.label)).size).toBe(c.links.length);
});
```

- [ ] **Step 2: Run and see it fail**

Run: `npx jest tests/lib/marketing/footer-links.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Move the link data** from `LandingFooter.tsx` into `footer-links.ts` unchanged, then apply: Features "Pricing" href becomes `/pricing`; Company column becomes About Khatario, Contact (`/contact`), Book a demo, Partners, Start free ("Log in" is removed; it stays in the header).

- [ ] **Step 4: Update `LandingFooter.tsx`.** Import the data. Under the brand blurb add: the support email as a `mailto:` link; the phone as a `tel:` link only when `telHref(fact('phone'))` is not null; a row of social icons from `socialLinks()` (lucide `Instagram`, `Youtube`, `Facebook`, `Linkedin`, `Twitter`; each `<a target="_blank" rel="noopener noreferrer" aria-label="Khatario on Instagram">` and so on), with the whole row absent when the list is empty. The legal row renders `FOOTER_LEGAL_LINKS`. Copyright line: `© 2026 {companyName()}. All rights reserved.`

- [ ] **Step 5: Run the tests and the type check**

Run: `npx jest tests/lib/marketing && npm run typecheck`
Expected: PASS.

---

### Task 10: Whole-change checks and hand-over

**Files:**
- Modify: `docs/project.log.md` (append), `docs/roadmap.md` (move the card's text to "built, awaiting staging")

- [ ] **Step 1: Run everything**

Run: `npm test -- tests/lib/marketing tests/lib/auth` then `npm run typecheck` then `npm run lint`
Expected: all pass, no new lint warnings in the files this plan touched.

- [ ] **Step 2: Search for leftovers**

Run: `grep -rn "being prepared" app components lib` and `grep -rn "'/#pricing'\|\"/#pricing\"" components/marketing/MarketingSiteHeader.tsx components/marketing/landing/LandingFooter.tsx lib/marketing`
Expected: no matches.

- [ ] **Step 3: Refresh the code graph**

Run: `graphify update .`

- [ ] **Step 4: Append the project log entry and update the roadmap card.** List the dropped security claims, the third parties named in the privacy policy, and the open items below.

- [ ] **Step 5: Report to the owner**: files changed (for a commit by name), nothing committed unless asked, and the two lists below.

## Staging checklist (after the owner deploys to `https://staging.khatario.com`)

1. Signed out, open `/contact`, `/refund-policy`, `/privacy`, `/terms`, `/pricing`, `/security`. Each shows the marketing header and footer, one main heading and no "being prepared" text.
2. Signed in to a business in the same browser, open the same six pages. None redirects to the dashboard or to login.
3. `/pricing` shows the same plans and prices as the home page's pricing section, for Billing, HR and Connect. `/pricing?product=hr` opens on HR.
4. Header "Pricing" (desktop and phone menu) opens `/pricing` from the home page and from `/about`.
5. Footer on the home page: Contact, Pricing, Refund policy and Security open their pages. No social icons, phone, address or GSTIN show while the company facts are blank.
6. `/contact` with blank facts: email card and hours show; no "Registered office" heading; the grievance section shows the support email and the 48 hours and 15 days line.
7. Contents links at the top of `/privacy` jump to their sections without the header covering the heading.
8. Phone width (375px): all six pages read without sideways scrolling.
9. Signup page: the Terms and Privacy links open the new pages.
10. `/sitemap.xml` lists `/contact`, `/pricing`, `/refund-policy` and `/security`.
11. A tenant store (`<shop>.staging.khatario.com`) still shows its own Privacy and Terms pages, not these.
12. View the page source of `/pricing` (not the inspector): it contains the plan names and exactly one `<h1>`. Open `/pricing?product=hr` and confirm the HR plans show without first flashing Billing plans.
13. Open `/pricing/` (with the trailing slash) signed out: it lands on `/pricing`, not on the login page.
14. Edit a bill, open its History tab and confirm the earlier version is shown. `/security` says "You can still see how a bill looked before a change"; if this step fails, remove that sentence from `lib/marketing/security-claims.ts` before production.
15. In Settings, Subscription, confirm there is a cancel action and that it says the plan ends at the end of the paid period, as `/refund-policy` states.

## Owner actions before production

1. Fill `lib/marketing/company-facts.ts` (legal name, registered address, phone, GSTIN, grievance officer name and email, jurisdiction city, social links) and delete the "ships with every fact blank" test.
2. Have a lawyer or CA read `/privacy`, `/terms` and `/refund-policy`.
3. Confirm support can honour the 7-day refund and the 48 hour and 15 day grievance timelines.
