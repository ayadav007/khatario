# SEO agent memory

Updated by the scheduled SEO tasks after every run. Newest entries at the top of each log.

## Current status
- 2026-10-31: GSC 0 clicks, 57 impressions (range to 2026-10-29), up from 41; `/guides` 56 impressions at avg position 7.5 (16 on 10-29 at 7.6), still no visible queries. All 6 key URLs indexed; `/blog` recrawled 2026-10-29. Health all green. Blog still 0 articles: writer run of 2026-10-29 still stuck "running", so the Friday 10-30 run never fired — flagged to owner again. No page optimised (no trigger met); `/guides` should cross 100 impressions in ~2–3 days of data → then apply the title/description/H1 rewrite.
- 2026-10-30: GSC 0 clicks, 41 impressions (range to 2026-10-28), up from 14; `/guides` 40 impressions at avg position 7.5 (27 on 10-28 alone), still no visible queries. All 6 key URLs indexed; home recrawled 2026-10-29. Health all green. Blog still 0 articles: writer run of 2026-10-29 stuck "running" since 14:11 (likely an unanswered permission prompt) — flagged to owner. No page optimised (no trigger met); `/guides` likely crosses 100 impressions within ~3 days → then apply the title/description/H1 rewrite.
- 2026-10-29: GSC 0 clicks, 14 impressions (range to 2026-10-27), up from 7; `/guides` 13 impressions at avg position 8.1 (7.3 on 10-26, 8.7 on 10-27), still no visible queries. All 6 key URLs indexed; `/guides` recrawled 2026-10-29. Health all green. Blog API returns 0 articles: the writer job has saved no drafts yet (flagged to owner). No page optimised (no trigger met).
- 2026-10-28: first real impressions. GSC 0 clicks, 7 impressions (range to 2026-10-26); `/guides` got 6 impressions at avg position 7.3 on 2026-10-26, queries still anonymised. All 6 key URLs indexed, health all green. No page optimised (no trigger met). Watch `/guides`: if it reaches ~100 impressions with CTR <2%, rewrite title/description and add a keyword H1 (current H1 "Find the right help for your business").
- 2026-10-27: no change in GSC (0 clicks, 1 impression, no queries; range to 2026-10-25). All 6 key URLs still indexed; `/guides` recrawled 2026-10-27. Health all green. No page optimised (no trigger met).
- 2026-10-26: all 6 key URLs indexed with apex canonicals; `/guides` fixed itself (recrawled 2026-10-26, Google canonical now `https://khatario.com/guides`). GSC: 0 clicks, 1 impression (www home, 2026-10-23, no query shown). Still no query data, so no page optimised.
- 2026-10-25: 5 of 6 key URLs indexed (`/`, `/solution/accounting`, `/solution/inventory`, `/blog`, `/book-demo`). `/guides` is "Duplicate without user-selected canonical": Google picked `www.khatario.com/guides` on a crawl before the canonical/redirect were live; both are live now, so owner should Request indexing. Still 0 impressions (GSC lag). No page optimised because there is no query data yet.
- 2026-10-25: production at `c15e7e9a`. Agent blog API live and verified (`GET /api/seo-agent/blog` → 200 with key, 401 without). All public pages have their own title, description and absolute canonical; home has Organization/WebSite/SoftwareApplication + FAQPage JSON-LD; share image live. Audit: 0 high, 0 medium, 5 low.
- 2026-10-24: sitemap submitted (8 URLs, read successfully); only `/` indexed so far. www → apex redirect live.

## Content backlog (writer takes the top unchecked item)
- [ ] GST bill kaise banaye mobile se — step by step (Hinglish) — kw: "gst bill kaise banaye"
- [ ] How to send a GST invoice on WhatsApp (and get paid faster with a UPI QR) — kw: "send gst invoice on whatsapp"
- [ ] Udhaar khata app: track customer credit and send WhatsApp reminders (Hinglish) — kw: "udhaar khata app"
- [ ] Billing software for fertilizer shops (khad beej dukan): batch, expiry, GST — kw: "fertilizer shop billing software"
- [ ] Tax invoice vs bill of supply: which one should your shop issue? — kw: "tax invoice vs bill of supply"
- [ ] GSTR-1 for small shops: what to file, due dates, common mistakes — kw: "gstr 1 filing for small business"
- [ ] Paint shop billing software: shades, tins and GST in one bill — kw: "paint shop billing software"
- [ ] Tiles and sanitary shop billing: boxes vs square feet, GST rates — kw: "tiles shop billing software"
- [ ] Dukan ka hisab kitab kaise rakhe: daily sales, stock, udhaar (Hinglish) — kw: "dukan ka hisab kitab"
- [ ] GSTR-2B reconciliation for small businesses, explained simply — kw: "gstr 2b reconciliation"
- [ ] Mobile accessories shop billing: IMEI, barcodes and GST — kw: "mobile shop billing software"
- [ ] Medical shop billing app with batch and expiry alerts — kw: "medical shop billing app"
- [ ] Kirana store billing app with WhatsApp bills — kw: "kirana billing app"
- [ ] HSN code on invoices: when it's required and how many digits — kw: "hsn code on invoice"
- [ ] Billing app that works offline: what to look for — kw: "offline billing app"

## Articles drafted
| Date | Title | Slug | Draft id | Keyword | Status |
|---|---|---|---|---|---|

## Changes made
| Date | Job | Change | Files / URL |
|---|---|---|---|
| 2026-10-25 | job1 | GSC script records googleCanonical/userCanonical per inspected URL (landed in owner commit ce8a9e0a) | scripts/seo/gsc-report.mjs |
| 2026-10-24 | setup | robots.ts, titles/descriptions/canonicals on all public pages, home JSON-LD, default share image, www redirect | app/*, nginx |

## Experiments to evaluate (check results ~3 weeks after the change)
| Date | Page | Change | Metric before | Check on |
|---|---|---|---|---|
