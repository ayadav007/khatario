---
title: Email, payments, AI agent, WhatsApp bot and other integration settings
audience: [tenant_user]
locale: en
tags: [email, smtp, gmail, sms, payment providers, upi, razorpay, ai sales agent, ai assistant, whatsapp bot, bot settings, integrations, workflow automation, account mappings, how to]
url: /settings/integrations
---

# Integration settings: how-to

## How do I send invoices by email?

Khatario sends email through your own email account, so you must set it up first:
1. Go to Settings > Integrations > Email (SMTP) and tick **Enable outbound email for this business**.
2. For Gmail: SMTP host smtp.gmail.com, port 587, SMTP username = your Gmail address, SMTP password = a Gmail App Password (create one in your Google account under Security > App passwords; your normal password will not work if 2-step verification is on). For Outlook, Zoho or others, use their SMTP details.
3. Fill in From email and From name (your business name), and optionally Reply-to.
4. Tap Save settings, then Test connection, and optionally Send test to your own address.

Until this is set up, sending an invoice or reminder by email shows "Email is not configured for your business". Daily email sending depends on your plan.

## Can I send SMS to customers?

Not yet. SMS messaging is shown as Coming soon in Settings > Integrations. Use WhatsApp to send invoices and reminders instead.

## How do I add my UPI ID or a payment gateway?

Go to Settings > Integrations > Payment providers.
- **Automatic Payments**: connect Razorpay, Cashfree, PayU, PhonePe Business or Instamojo. Payments made through the link are confirmed automatically. If you connect more than one, choose the Preferred provider.
- **Manual Payments**: tap Add Payment Method, choose Method Type UPI (or Bank Transfer, Wallet), enter a Method Name and your UPI ID (for example yourname@ybl), and tick Default (used for payment links). This UPI ID is used in payment links sent on WhatsApp when no gateway is connected.

## How do I set up the AI sales agent for WhatsApp?

The AI agent replies to your customers' WhatsApp messages automatically using your products, prices and policies, can take orders, and hands chats to your team when needed. It needs the Khatario Connect plan.
1. Go to Settings > WhatsApp > AI agent (Settings > Integrations > AI Sales Agent opens the same page).
2. Fill in Profile & tone, then Knowledge & products (FAQs, files or pasted text, and which items it may sell).
3. Under Skills & payments choose what it may do, such as answer questions, take orders and share order status.
4. Under Hours & handoff set your business hours and who takes over a chat.
5. Under Testing & AI model, choose Khatario AI (no setup; replies come with Connect) or My own API key (Groq, OpenAI or Gemini, paid to the provider directly), and add 2–3 of your own numbers as test numbers.
6. The agent starts in Test mode, where only test numbers get replies. Use Test your agent to try it, then tap Go live to reply to every customer.

## What is the AI assistant settings page?

There is no separate AI assistant page any more. Old links to Settings > AI assistant open Settings > WhatsApp > AI agent, where all automatic WhatsApp replies are set up.

## What is in the WhatsApp settings, and what does each need?

Settings > WhatsApp:
- **Connection** (every plan): link your WhatsApp number by QR code. The Meta Cloud API section (your own WhatsApp Business Account) needs the Connect plan.
- **Reminders** (Starter plan and above): automatic payment reminders, with links to send reminders now and to the reminder history.
- **Team & inbox, AI agent, Templates, Shop**: need the Connect plan. Team & inbox holds WhatsApp agents, chat sharing and saved replies.

Sending invoices and one-off reminders works on every plan. Automatic and bulk reminders start at Starter and do not need Connect.

## What integrations are available?

Settings > Integrations > All integrations lists Email (SMTP), Send invoices on WhatsApp and AI Sales Agent. SMS messaging is coming soon. Payment gateways are set up separately in Payment providers. There is no Tally, Shopify or Amazon integration yet.

## Can I automate tasks with workflow automation?

Not yet. The Workflow automation page in Settings > General is a preview and workflows created there do not run. For automatic payment reminders, use Settings > WhatsApp > Reminders (Starter plan and above).

## What are account mappings and do I need them?

Settings > Accounting > Account mappings decides which ledgers Khatario posts to: Sales, Accounts Receivable, Purchases, Accounts Payable, Cash, Bank, Inventory, COGS and Expense. Khatario sets these up automatically from the default chart of accounts, so most businesses never need to change them. Use it only if your CA renamed or replaced ledgers: tap Auto-Detect to refill from the default accounts, or pick accounts yourself and tap Save Changes.

UPI and other non-bank payments post to the Cash account; payments marked bank transfer, NEFT or RTGS post to the Bank account.
