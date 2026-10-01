---
title: How to prepare GST returns and reports
audience: [tenant_user]
locale: en
tags: [gst, gstr-1, gstr-3b, gstr-2b, return, report, how to]
url: /reports/gst/gstr1
required_feature: reports_gst
---

# GST returns: how-to

## How do I prepare GSTR-1?

1. Go to Reports > GST Reports > GSTR-1.
2. Choose the month or quarter.
3. Check the summary and the sections (B2B, B2C, credit notes, HSN summary). Fix any flagged invoices, such as a missing GSTIN.
4. Export as Excel, offline-tool Excel or JSON and upload it on the GST portal, or send it to your CA.
5. After filing on the portal, mark the return as filed in Khatario. This locks the period so the filed invoices cannot be changed.

Khatario does not file returns directly on the GST portal.

## How do I prepare GSTR-3B?

Reports > GST Reports > GSTR-3B shows the output tax from sales and the input tax credit from purchases for the period. Compare it with GSTR-1 using GSTR-1 vs 3B.

## How do I match purchases with GSTR-2B?

Download GSTR-2B from the GST portal, upload it in Reports > GST Reports > GSTR-2B, then use GSTR-2B Reconciliation to see which supplier bills match, which are missing and which differ.

## What are GST alerts?

Reports > GST Reports > GST Alerts lists GST deadlines that need your attention. Khatario checks your books every morning and also when you open the page. It currently watches three things:

1. **Unpaid supplier bills near 180 days (Rule 37).** If you do not pay a supplier within 180 days of the bill date, you must reverse the input tax credit on the unpaid part. The alert starts 30 days before the limit. Once a bill crosses 180 days, the alert offers a Post ITC reversal button.
2. **30 November deadline.** From October, it lists last year's supplier invoices that appear in GSTR-2B but are not booked in Khatario, because input tax credit for a financial year can only be claimed until 30 November of the next year (Section 16(4)). In November it also reminds you that credit notes for last year's sales must be issued by 30 November (Section 34(2)).
3. **GSTR-3B due date.** It reminds you 5 days before GSTR-3B is due for a period that had sales or purchases, and shows the per-day late fee and the 18% interest that apply if you file late.

Each new or more urgent alert also appears in the notification bell. Click Dismiss if you have already handled an alert. It comes back only if it becomes more urgent. Ask why opens the assistant with an explanation of the rule. Composition and unregistered businesses do not get these alerts.

These alerts are reminders, not legal advice. Check with your CA before acting on them.

## Is there an annual return view?

Yes. Reports > GST Reports > GSTR-9 summarises the year.

## Why can't I see GST reports?

GST reports are included in the Business and Enterprise plans and in the free trial. On other plans the menu shows an upgrade prompt.
