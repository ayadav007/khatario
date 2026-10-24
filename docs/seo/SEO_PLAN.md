# Khatario SEO plan (started 2026-10-24)

## Where we stand (audit, 2026-10-24)

| Check | khatario.com (production) | staging |
|---|---|---|
| Build | `production` branch at `64ea128` (2026-09-26), 244 commits behind `main` | current `main` |
| `/robots.txt` | 404 | 404 (fixed in repo: `app/robots.ts`) |
| `/sitemap.xml` | 404 | 200 |
| `/blog`, `/solution/accounting`, `/solution/inventory`, `/privacy` | 404 | 200 |
| Home title | "Modern Invoice & Billing" (generic) | "Khatario — GST Billing, Stock & WhatsApp Invoices for Indian Shops" |
| `www.khatario.com` | 200, no redirect (duplicate site) | – |
| Google index | 0 pages found | should be **noindex** (now disallowed by `robots.ts`) |
| Blog posts | none | none |

Fixed in repo: `app/robots.ts` (production allows crawling with a sitemap; every other host, including staging, is disallowed), and the solution pages no longer render "| Khatario - Khatario" in the title.

**Update 2026-10-24 (later):** production deployed to `fd7b8525` (same code as `main`). robots.txt, the sitemap, blog, guides and solution pages are live (200). Sitemap submitted to Search Console. `www.khatario.com` now 301s to `https://khatario.com` (nginx backup at `/root/nginx-khatario.bak-2026-10-24-1221`). Week 1 steps 1–3 are done except the owner's manual "Request indexing" in Search Console.

## Honest target for 30 days

A new domain with no backlinks will not reach page 1 for head terms like "GST billing software" or "billing app" in a month. myBillBook, Vyapar, Swipe, Zoho and ClearTax hold those with thousands of pages and links. The 30-day goal is page 1 for the keyword tiers below, plus impressions in Search Console for the head terms so we can push them later.

### Tier A: brand (page 1 within days of indexing)
`khatario`, `khatario app`, `khatario billing`, `khatario login`, `khatario gst`

### Tier B: low-competition long tail (page 1 possible in 2–6 weeks)
These SERPs are weak or have no billing vendor ranking (checked 2026-10-24):
- **Hindi/Hinglish intent:** `GST bill banane wala app`, `dukan ka hisab kitab app GST`, `udhaar khata aur GST bill app`, `WhatsApp par bill bhejne wala app`. Source copy already exists in `knowledge/prospect/faq-hinglish.md`.
- **Niche shop type + feature**, one page each: `billing software for fertilizer shop` (khad beej), `tiles and sanitary shop billing software`, `paint shop billing software`, `mobile accessories shop billing app`, `sweet shop billing software`, `medical shop billing app with expiry`, `kirana billing app with WhatsApp`.
- **Feature-led:** `GST invoice WhatsApp reminder app`, `GSTR-2B reconciliation for small business`, `billing app works offline India`, `scan purchase bill to add stock app`.

### Tier C: head terms (3–6 months, build toward now)
`GST billing software`, `billing software for small business India`, `inventory management software for small business`, `accounting software India`, `free invoice generator GST`.

Search volumes above are unverified estimates; Search Console impressions replace them from week 2.

## Work plan

**Week 1 (needs owner, see "Owner actions")**
1. Promote `main` to `production` and deploy, so robots, sitemap, solution pages and blog go live.
2. 301 `www.khatario.com` to `khatario.com` in nginx.
3. Submit `https://khatario.com/sitemap.xml` in Search Console; request indexing for `/`, `/solution/accounting`, `/solution/inventory`, `/guides`.
4. Add Organization + SoftwareApplication JSON-LD to the home page.

**Weeks 1–3 (content)**
5. One landing page per Tier B shop type (`/billing-software/<shop-type>`), with real screenshots and an FAQ block. Add each to `STATIC_PATHS` in `app/sitemap.ts`.
6. Hinglish landing page plus 4–6 Hinglish blog posts.
7. Two blog posts a week on Tier B feature queries, each linking to the matching solution page.

**Ongoing (daily agent)**
8. `scripts/seo/gsc-report.mjs` pulls queries, pages, sitemap status and index status into `docs/seo/reports/<date>.json`.
9. Daily: compare with yesterday; for queries at position 8–20, rewrite title/description/H1 or add a section; for pages with impressions but CTR under 2%, rewrite the title and description.

## Owner actions (only you can do these)
- [x] Add the service account email as a **Full** user in Search Console > Settings > Users and permissions.
- [ ] Put the JSON key outside the repo (e.g. `C:\Users\Abhishek\.secrets\gsc.json`) and tell Claude the path. Never commit it.
- [x] Approve deploying `main` to production.
- [ ] Request indexing in Search Console for `/solution/accounting`, `/solution/inventory`, `/guides`, `/book-demo`.
- [ ] Create a Google Business Profile for Khatario (brand panel, local queries).
- [ ] Backlinks: list Khatario on Product Hunt, G2, Capterra, SoftwareSuggest, Techjockey, and IndiaMART; post the Play Store listing link on the site.
- [ ] Share 3–5 real customer quotes and screenshots for the landing pages.

## Running the report
```bash
GSC_KEY_FILE=/c/Users/Abhishek/.secrets/gsc.json node scripts/seo/gsc-report.mjs
```
