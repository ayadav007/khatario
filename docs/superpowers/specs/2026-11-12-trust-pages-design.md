# Trust pages for khatario.com: design

Date: 2026-11-12. Phase 1 of 4 of the "missing marketing pages" work.

## Why

The home page was compared with the home pages of established SaaS sites (Zoho, Vyapar, myBillBook, Razorpay). Khatario lacks the pages a buyer, Google and a payment gateway look for before trusting a company. Two pages that do exist, `/privacy` and `/terms`, only say "This policy is being prepared".

## Phases (this spec covers phase 1 only)

1. **Trust pages** (this spec).
2. Product pages: GST billing, Online store, WhatsApp marketing, Staff & HR, Payments, Download app.
3. Search pages: eight industry pages, compare pages, free tools.
4. Proof and support: public help centre, customer stories.

Each later phase gets its own spec and plan.

## Goal and success

A visitor can find, from the footer of any marketing page: how to contact Khatario, what a plan costs, the refund rule, the privacy policy, the terms and how data is kept safe. Every page shows only facts that are true and filled in.

Done means:
- `/contact`, `/refund-policy`, `/pricing` and `/security` exist; `/privacy` and `/terms` carry real text.
- All six are linked from the marketing footer, listed in the sitemap and open without a login redirect.
- A company fact left blank shows nothing (no empty label, no invented value).
- Unit tests pass and the staging checklist at the end of the plan is written.

## Decisions already made by the owner

- Trust pages first.
- Refund rule: full refund when asked within 7 days of a business's first payment; no refund on renewals; cancel any time and the plan runs to the end of the paid period.

## Approach

Plain static Next.js pages in the pattern of `app/about/page.tsx` (server component, `MarketingSiteHeader`, `LandingFooter`, `metadata`, JSON-LD).

Rejected:
- Admin site builder (`lib/marketing-builder`): it serves only the `home` document today; extending it is a separate project.
- Markdown/MDX files: a new dependency for six pages.

## Shared pieces

### 1. Company facts: `lib/marketing/company-facts.ts`

One typed constant, `KHATARIO_COMPANY_FACTS`, and small helpers. Fields, all strings, blank by default:

| Field | Used on |
|---|---|
| `legalName` | Contact, Privacy, Terms, Refund, footer copyright line |
| `registeredAddress` (multi-line) | Contact, Privacy, Terms |
| `phone` | Contact, footer |
| `gstin` | Contact |
| `grievanceOfficerName` | Contact, Privacy |
| `grievanceEmail` | Contact, Privacy (falls back to the support email) |
| `jurisdictionCity` | Terms (governing law clause) |
| `social.instagram`, `social.youtube`, `social.facebook`, `social.linkedin`, `social.x` | Footer, Organization JSON-LD `sameAs` |

Rules:
- A blank field renders nothing. Helpers: `fact(name)` returns the trimmed value or `null`; `socialLinks()` returns only the set links, each validated as an `https://` URL.
- Where legal text needs the company name and `legalName` is blank, the text says "Khatario".
- Email, WhatsApp link and hours keep coming from `getPublicSupportConfig()` (`lib/marketing-public-config.ts`); they are not duplicated here.
- `KHATARIO_PROFILE_URLS` in `lib/marketing/brand-structured-data.ts` is merged with `socialLinks()` for `sameAs`, without duplicates.

The owner fills this file before production. The build does not depend on the values.

### 2. Page shell: `components/marketing/MarketingPageShell.tsx`

Server component: `MarketingSiteHeader`, a `<main>` with `LANDING_PAGE_GUTTER`, an optional hero block (`title`, `intro`), `children`, `LandingFooter`. Used by Contact, Refund, Privacy, Terms and Security. Pricing uses header and footer directly because its body is the full-width pricing section.

### 3. Legal text layout: `components/marketing/LegalDocument.tsx`

Renders a policy from data, not from hand-written JSX per page:

```ts
type LegalSection = { id: string; heading: string; paragraphs?: string[]; bullets?: string[] };
type LegalDocumentProps = { updatedOn: string; sections: LegalSection[] };
```

Shows "Last updated: 12 November 2026", a short contents list linking to each `id`, then the sections. Readable width (`max-w-3xl`), light theme only, like the other marketing pages. The text for each policy lives in `lib/marketing/legal/privacy.ts`, `terms.ts` and `refund.ts`, each exporting `updatedOn` and `sections` built with the company facts.

## Pages

### `/contact`

- Cards for: email (mailto), WhatsApp (only when `whatsappUrl` is set), phone (only when set), support hours.
- "Registered office": legal name, address, GSTIN, each only when set. The whole block is hidden when all three are blank.
- "Grievance officer" (as expected under the IT Rules 2021 and the DPDP Act): name when set, email (grievance email, else support email), and the line that complaints are acknowledged within 48 hours and resolved within 15 days.
- Links to `/book-demo` (sales) and `/guides` (how-to help).
- No contact form: `/book-demo` already collects enquiries, and a second form means spam handling and a new API route.
- JSON-LD: `ContactPage` plus the shared Organization node.

### `/refund-policy`

Sections: the 7-day rule; what is not refunded (renewals, a first payment older than 7 days, WhatsApp message charges and other usage already consumed, add-on services already delivered); how to cancel (in the app under Settings, Subscription, or by writing to support) and that the plan stays active until the paid period ends; how to ask for a refund (email support from the registered phone or email with the business name and payment date); timing (approved refunds go back to the original payment method in 5 to 7 working days); free plan (nothing to refund); contact.

### `/privacy`

Replaces the placeholder. Plain language. Sections: who we are; what we collect (account details: name, phone, email, business name, GSTIN; business records the user enters: bills, customers, suppliers, stock, staff and attendance; payment records from the payment gateway, never card numbers; device and usage data; location and device checks for staff attendance check-in); why we use it; who we share it with (hosting, payment gateway, WhatsApp/Meta when the business uses WhatsApp features, SMS/OTP provider, AI providers for bill scanning and Ask Khatario); the business's customers' data (the business is the owner of that data, Khatario processes it for them); retention and deletion; the user's rights under the DPDP Act 2023 (access, correction, erasure, grievance); cookies; children; changes; grievance officer and contact.

Each "what we collect" and "who we share with" line must match what the code does. The plan includes a task to confirm each third party from the codebase (payment gateway, OTP/SMS provider, AI provider, analytics/pixels) and to drop any line that cannot be confirmed.

### `/terms`

Replaces the placeholder. Sections: acceptance; the account (one business owner responsible, keep login safe); plans, payments and renewal; refunds (links to `/refund-policy`); acceptable use (no unlawful bills, no spam on WhatsApp, follow Meta's policies); the user's data (the business owns it, can export it); the online store (the business is the seller, not Khatario); tax responsibility (the app helps prepare GST bills and reports; correctness of filings stays with the business); availability and changes to the service; limitation of liability; suspension and termination; governing law (India; courts at `jurisdictionCity` when set, else "the courts of India"); changes to the terms; contact.

Both `/privacy` and `/terms` keep working as the targets of the existing links in `app/signup/page.tsx`, `components/auth/PublicWhatsAppOtp.tsx` and `lib/more-navigation.ts`. The current "Back to sign up" link is dropped; the marketing header gives navigation.

### `/pricing`

- Server component loads `loadPricingCatalog()` (same call and error handling as `app/page.tsx`) and renders `LandingProductProvider` + `LandingPlansProvider initialCatalog={...}` around the existing `LandingPricing`, so plans, cycles and the Billing/HR/Connect toggle behave exactly as on the home page. A small client wrapper, `components/marketing/pricing/PricingPageBody.tsx`, holds the providers.
- `?product=hr` and `?product=connect` select the product line, as on the home page.
- Below the plans: "Billing questions" (six plain questions: is there a free plan, how do I pay, can I change plan, what happens when a plan ends, is GST added to the price, can I get a refund, linking to `/refund-policy`). Rendered as static text with `FAQPage` JSON-LD.
- Final call to action: Start free (`/signup`), Book a demo (`/book-demo`).
- `revalidate = 300`, as on the home page.
- The home page keeps its `#pricing` section. Links that mean "go to pricing" from other pages change to `/pricing`: the header link (`MarketingSiteHeader.tsx` lines 391 and 521) and the footer link. `LandingHero`'s `#pricing` (same-page scroll) and `lib/rag/ingest/plans-source.ts` stay as they are.
- No answer may state a price or limit in text; numbers come only from the live catalogue.

### `/security`

Title: "How Khatario keeps your data safe". Only claims confirmed from the code or `docs/SERVER_INFRASTRUCTURE.md`. Candidate claims, each to be confirmed in the plan before it is written:

| Claim | Where to confirm |
|---|---|
| All traffic is encrypted (HTTPS) | nginx config in `docs/SERVER_INFRASTRUCTURE.md` |
| Each business's data is kept separate from every other business | session-derived `business_id` (AGENTS.md guardrail), row-level security spec `2026-11-05-row-level-security-design.md` and its state |
| Login by OTP; staff see only what their role allows | auth code, PBAC tests under `tests/pbac` |
| Regular backups | backup cron under `app/api/cron/` and server docs: state the real frequency |
| Where the servers are | server docs: state the country only if documented |
| Payments are handled by the gateway; card details never reach Khatario | payment integration code |
| You can export your data | `app/(app)/settings/export` |
| Every change to an invoice is recorded | invoice history (migration 469), only once it is live on production |

A claim that cannot be confirmed is left out. No certification is claimed (no ISO, SOC 2 or "bank-grade") and no banned phrase from the marketing claims list is used. Ends with "Report a security problem" pointing to the support email.

## Links, search and access

- **Footer** (`LandingFooter.tsx`): Company column gains "Contact" (replacing "Log in", which stays in the header); Features column's "Pricing" points to `/pricing`; the legal row becomes Privacy, Terms, Refund policy, Security. Under the brand blurb: support email, phone when set, and social icons from `socialLinks()` (the row is absent when none are set). Copyright line uses `legalName` when set.
- **Sitemap** (`app/sitemap.ts`): add `/contact`, `/pricing`, `/refund-policy`, `/security` to `STATIC_PATHS`.
- **Public surfaces** (`lib/auth/public-surfaces.ts`): add `/contact`, `/pricing`, `/refund-policy`, `/security`, so a stale session does not hydrate the app shell or redirect to login on these pages. Add the same four to the public path list in `middleware.ts` (the list near line 80 that already holds `/book-demo`, `/terms` and `/privacy`). Extend `tests/lib/auth/public-surfaces.test.ts`.
- **Metadata**: each page sets an absolute title, description, canonical, Open Graph and Twitter fields like `/about`.
- **Organization JSON-LD** (`brand-structured-data.ts`): add `legalName`, `telephone`, `address` and `sameAs` when the facts are set.

## Out of scope

- A contact form, live chat, or a status page.
- Editing these pages from the admin site builder.
- Hindi or other language versions.
- Any change to plans, prices, payment or refund processing in the app. The refund page states a rule that support applies by hand.
- Tenant store pages under `app/store/*` (each store has its own privacy, terms and refund pages).

## Testing

Unit tests (Jest, node environment, under `tests/lib/marketing/` and beside existing tests; page text lives in `lib/` data files so it can be tested without rendering):
- `company-facts`: blank values return `null`; `socialLinks()` drops blank and non-https values.
- Legal documents: every section has a unique `id`, a heading and some content; no `TODO`/placeholder text; refund text contains the 7-day rule.
- `public-surfaces`: the four new paths are public; an app path such as `/invoices` is not.
- Sitemap: the four new paths are present.
- Organization JSON-LD: omits `address`, `telephone` and `sameAs` when facts are blank, includes them when set.

No local browser run (owner preference). The plan ends with a staging checklist: each page opens signed out and signed in, footer links work, pricing shows the same plans as the home page, phone layout at 375px, blank facts show nothing, `/sitemap.xml` lists the pages.

## What the owner must do before production

1. Fill `lib/marketing/company-facts.ts`: legal name, registered address, phone, GSTIN, grievance officer name, jurisdiction city, social links.
2. Have a lawyer or CA read `/privacy`, `/terms` and `/refund-policy`. The drafts are plain-language starting points, not legal advice.
3. Confirm the support team can honour the 7-day refund by hand.
