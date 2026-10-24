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

Reports > GST Reports > GST Alerts lists GST deadlines and rules that need your attention. Khatario checks your books every morning and also when you open the page. It watches:

1. **Unpaid supplier bills near 180 days (Rule 37).** If you do not pay a supplier within 180 days of the bill date, you must reverse the input tax credit on the unpaid part. The alert starts 30 days before the limit. Once a bill crosses 180 days, the alert offers a Post ITC reversal button.
2. **30 November deadline.** From October, it lists last year's supplier invoices that appear in GSTR-2B but are not booked in Khatario, because input tax credit for a financial year can only be claimed until 30 November of the next year (Section 16(4)). In November it also reminds you that credit notes for last year's sales must be issued by 30 November (Section 34(2)).
3. **GSTR-3B due date.** It reminds you 5 days before GSTR-3B is due for a period that had sales or purchases, and shows the per-day late fee and the 18% interest that apply if you file late. If you mark your returns as filed, it also tells you when a return is late.
4. **E-way bills.** It lists goods invoices from the last week above the e-way bill limit that have no e-way bill number. This one shows only on the page, not in the bell, because the buyer or transporter may have generated the e-way bill.
5. **E-invoicing.** If last year's sales recorded in Khatario cross the e-invoicing limit, or your business profile says turnover is above 5 crore, it reminds you that B2B invoices need an IRN from the e-invoice portal.
6. **Reverse charge self-invoices.** For reverse charge purchases from suppliers without a GSTIN, it reminds you to issue a self-invoice within 30 days.

Each new or more urgent alert also appears in the notification bell, and the most urgent ones are emailed to the business email and the main admin. Click Dismiss if you have already handled an alert. It comes back only if it becomes more urgent. Ask why opens the assistant with an explanation of the rule. Unregistered businesses do not get these alerts. Composition businesses get only the e-way bill and reverse charge alerts.

## How do I mark GSTR-3B as filed?

After you or your CA file GSTR-3B on the GST portal, open Reports > GST Reports > GSTR-3B, choose the month and click Mark as filed. You can also click Mark as filed on the GSTR-3B alert. Enter the filing date and, if you like, the ARN from the portal. Quarterly (QRMP) filers mark the whole quarter at once. This only records the filing so reminders stop; it does not lock your books. Click Undo if you marked the wrong period.

These alerts are reminders, not legal advice. Check with your CA before acting on them.

## Is there an annual return view?

Yes. Reports > GST Reports > GSTR-9 summarises the year.

## Why can't I see GST reports?

GST reports are included in the Business and Enterprise plans and in the free trial. On other plans the menu shows an upgrade prompt.
