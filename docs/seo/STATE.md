# SEO agent memory

Updated by the scheduled SEO tasks after every run. Newest entries at the top of each log.

## Current status
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
| 2026-10-24 | setup | robots.ts, titles/descriptions/canonicals on all public pages, home JSON-LD, default share image, www redirect | app/*, nginx |

## Experiments to evaluate (check results ~3 weeks after the change)
| Date | Page | Change | Metric before | Check on |
|---|---|---|---|---|
