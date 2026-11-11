---
title: How to manage WhatsApp leads, the pipeline and lead sources
audience: [tenant_user]
locale: en
tags: [leads, lead, enquiry, pipeline, deal, crm, follow up, reminder, lead source, click to whatsapp ads, tracked link, qr code, website button, indiamart, justdial, lead webhook, convert to customer, connect, how to]
url: /whatsapp/leads
---

# WhatsApp leads, pipeline and lead sources: how-to

## Where do I see my leads?

Leads are part of the paid Connect plan. Open Connect > Chats > **Leads**. Every enquiry is a lead with its name, number, source (how they came), stage, owner, temperature and last activity. Filter by source, stage, label or owner, or search. Open a lead to see its messages, an AI summary of the chat, its comments and follow-ups.

A lead starts automatically when:
- a new number messages your WhatsApp (not a customer, supplier, staff member or your own linked phone); it goes on the first open stage of the pipeline as "Direct";
- someone comes from a click-to-WhatsApp ad, a tracked link or QR code, your website button, IndiaMART or the lead webhook;
- a known number messages again after its last lead was won or lost, or after 30 quiet days.

To add one yourself (a phone call or walk-in), tap **Add lead**. Use **New enquiry** on a lead to start a fresh one for the same number.

Naye customer ki enquiry kaha dikhti hai? Connect > Leads mein. Jo bhi naya number message karta hai, wo apne aap lead ban jata hai.

## How do I use the sales pipeline?

Connect > Chats > **Pipeline** shows open leads as cards in stage columns. Drag a card to move it to another stage. On a lead you can set the owner, the deal value and the expected close date, and mark it won or lost (with why it was lost). Manage the stages (name, type and colour) from the board. A lead is moved to Won by itself when the converted customer's first invoice or sales order is made. The pipeline also works in the Khatario phone app.

## How do I set a follow-up reminder on a lead?

Open the lead and under **Follow-ups** pick a time (In 1 hour, This evening, Tomorrow 10 am, Next Monday, or your own date and time), add a reminder note and tap **Set reminder**. The person it is assigned to gets a notification when it falls due.

## How do I add comments to a lead?

Notes you write on a chat are filed under that chat's open lead and show in the lead's **Comments**. Leads without a chat (a call, walk-in or IndiaMART enquiry) can have notes too. Only the person who wrote a note or a supervisor can delete it.

## How do I turn a lead into a customer?

Open the lead and tap **Convert to customer**. Fill in the customer name, and the address and GSTIN if you have them, or link it to an existing customer.

## How do I set up lead sources?

Connect > Chats > **Lead sources**:

- **Click-to-WhatsApp ads**: nothing to set up. When someone taps your Facebook or Instagram ad and messages you, the chat is marked "WhatsApp ad" with the ad's headline and goes on the pipeline. This needs your number connected through the Meta Cloud API; numbers linked by QR code don't get ad details, so use a tracked link in the ad instead.
- **Tracked links, QR codes and website button**: create a link with a name (for example "Diwali poster"), the message they send, the pipeline stage, who gets the chat and labels. Share the link or its QR code, or paste the website button code on your site. You see which link each lead came from.
- **IndiaMART**: paste your CRM key from IndiaMART Lead Manager > Import/Export > CRM API and tap Connect IndiaMART. New IndiaMART leads arrive every 10 minutes.
- **Lead webhook** (JustDial, Facebook lead forms, website forms): create a webhook and send leads to its URL, for example through Zapier.
- **New numbers**: turn off "New numbers go on the pipeline" if you don't want every new chat to become a lead.
