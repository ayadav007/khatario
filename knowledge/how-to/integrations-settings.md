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

The AI sales agent replies to your customers' WhatsApp messages automatically using your product catalogue and prices. It needs the WhatsApp Bot add-on and your own AI provider API key.
1. Go to Settings > Integrations > AI sales agent.
2. Choose the AI Provider (Groq, OpenAI, Google Gemini, Anthropic Claude or a custom OpenAI-compatible API), paste your API Key (use Get API Key to create one), and optionally pick a Model.
3. Keep AI Sales Agent Chatbot and AI Lead Analyzer on.
4. Deployment Mode: start with Development and add 2–3 of your own numbers to test; switch to Production to reply to everyone.
5. Tap Save Configuration. Without the WhatsApp Bot add-on, saving shows "WhatsApp Bot addon required".

## What is the AI assistant settings page?

Settings > Integrations > AI assistant is a preview of personality options for customer-facing replies (business type, tone, offers, business hours). These settings are not saved yet, so use the AI sales agent page to set up automatic WhatsApp replies.

## What is in WhatsApp bot and messaging settings?

Settings > Connect > Bot & messaging (the Connect messaging page) has tabs:
- **Connection** (free): connect your WhatsApp number by QR code, or optionally the Meta Cloud API.
- **Bot Settings, Auto Reminders, Send Reminders, Logs**: need the WhatsApp Bot add-on (tap Unlock WhatsApp Bot addon). Bot Settings controls the typing animation and response delay; Auto Reminders schedules payment reminders; Send Reminders sends them in bulk; Logs show delivery history.

## What integrations are available?

Settings > Integrations > All integrations lists Email (SMTP), Send invoices on WhatsApp, AI Sales Agent and AI Assistant. SMS messaging is coming soon. Payment gateways are set up separately in Payment providers. There is no Tally, Shopify or Amazon integration yet.

## Can I automate tasks with workflow automation?

Not yet. The Workflow automation page in Settings > General is a preview and workflows created there do not run. For automatic payment reminders, use Auto Reminders in the WhatsApp bot settings.

## What are account mappings and do I need them?

Settings > Accounting > Account mappings decides which ledgers Khatario posts to: Sales, Accounts Receivable, Purchases, Accounts Payable, Cash, Bank, Inventory, COGS and Expense. Khatario sets these up automatically from the default chart of accounts, so most businesses never need to change them. Use it only if your CA renamed or replaced ledgers: tap Auto-Detect to refill from the default accounts, or pick accounts yourself and tap Save Changes.

UPI and other non-bank payments post to the Cash account; payments marked bank transfer, NEFT or RTGS post to the Bank account.
