// Third parties named in this policy, each confirmed from the code (Task 4 Step 1):
// Razorpay (Khatario's own plan payments, hosted payment link or checkout): lib/platform-subscription-checkout.ts, lib/payments/providers/razorpay-payment-provider.ts
// Easebuzz (Khatario's own plan payments, the other admin choice, hosted pay page): lib/platform-subscription-checkout.ts, lib/payments/providers/easebuzz-payment-provider.ts
// No card fields anywhere in app/, lib/, components/ (no card_number, cardNumber or cvv): card details are typed only on the gateway's page.
// Business's own payment gateway (Razorpay, Cashfree, PhonePe, PayU, Instamojo, Easebuzz), only when the business connects it: lib/payments/registry.ts, lib/payments/business-provider-config.ts
// WhatsApp (Meta), Cloud API at graph.facebook.com: lib/meta-whatsapp.ts; linked WhatsApp number: lib/baileys-hybrid.ts (@whiskeysockets/baileys)
// Sign-up and login codes go on WhatsApp, password reset codes also by email: lib/platform-public-otp.ts (issuePlatformOtp). No SMS provider exists in the code (no msg91, twilio or SMS env key), so none is named.
// Groq (Ask Khatario, bill scanning, Khatario AI): lib/rag/llm.ts, lib/services/ai-provider-factory.ts (getPlatformAIProvider), lib/services/invoice-extract/pipeline/groqVisionPipeline.ts
// Google Gemini (Ask Khatario, bill scanning, product labels): lib/rag/llm.ts, lib/rag/embed.ts, lib/services/invoice-extract/pipeline/geminiVisionPipeline.ts, lib/product-lookup/label-reader.ts
// Google Cloud Vision (bill scanning): lib/services/invoice-extract/pipeline/googleVisionGroqTextPipeline.ts
// Business's own AI key (OpenAI, Gemini, Groq or a custom provider), only when the business adds it: lib/services/ai-provider-factory.ts (shopProviderFromRow)
// Anthropic: only a type name in ai-provider-factory.ts, no client, so not named.
// Meta Pixel (CompleteRegistration on sign-up only, only when a pixel id is saved): components/marketing/SignupMetaPixel.tsx. No gtag, Google Analytics or Clarity found, so none is named.
// Email: nodemailer over SMTP from server settings, provider not fixed in code, so only the category is named: lib/email.ts, lib/platform-email.ts; business's own SMTP: lib/business-email.ts
// Firebase Cloud Messaging (push notifications): lib/push/fcm.ts (firebase-admin)
// Hostinger (servers) and Cloudflare (DNS; the HTTPS proxy is proven for staging only, so not claimed): docs/SERVER_INFRASTRUCTURE.md. Server country is not documented, so it is not stated.
// GST number lookups (public registry services and the GST portal): lib/gstin-registry.ts
// OpenStreetMap (street address of an office check-in site): lib/hr/staff-app/reverse-geocode.ts
// Google Drive and Dropbox backups, only when the business connects them: lib/cloud-storage.ts; Shiprocket delivery, only when connected: lib/store/delivery/shiprocket.ts
// Staff check-in: location samples with accuracy and a fake-location flag, nearby Wi-Fi names and router ids, rooted/emulator/developer-options/USB-debugging flags, IP address:
//   lib/hr/staff-app/punch.ts (parsePunchBody), lib/hr/staff-app/risk.ts, app/api/employees/attendance/check-in/route.ts (location, device_info, IP)
// Face check (optional, staff consent, matched on our own servers, templates deleted when staff leave or withdraw): lib/hr/staff-app/face/engine.ts, lib/hr/staff-app/face/store.ts, lib/hr/staff-app/face/enrollment.ts
// IP address and browser details in activity logs: lib/activity-logger.ts
// Export of all business data: app/(app)/settings/backup/page.tsx (app/(app)/settings/export redirects there)
// Permanent deletion of a business by the Khatario team: app/api/admin/businesses/[id]/route.ts (DELETE)

import { addressLines, companyName, fact } from '@/lib/marketing/company-facts';
import type { LegalContext, LegalDocumentData } from './types';

export function privacyPolicy(ctx: LegalContext): LegalDocumentData {
  const name = companyName(ctx.facts);
  const isLegalName = fact('legalName', ctx.facts) !== null;
  const address = addressLines(ctx.facts);
  const officerName = fact('grievanceOfficerName', ctx.facts);
  const grievanceEmail = fact('grievanceEmail', ctx.facts) ?? ctx.supportEmail;
  const grievanceMail = `[${grievanceEmail}](mailto:${grievanceEmail})`;
  const supportMail = `[${ctx.supportEmail}](mailto:${ctx.supportEmail})`;

  const whoWeAre = [
    'Khatario is an app for shops and small businesses in India. It does GST billing, stock, an online store, WhatsApp marketing and staff attendance and HR.',
    isLegalName
      ? `In this policy, "we" and "us" mean ${name}, the company that runs Khatario. "You" means the business that uses Khatario, and the people who use it for that business.`
      : 'In this policy, "we" and "us" mean Khatario. "You" means the business that uses Khatario, and the people who use it for that business.',
  ];
  if (address.length > 0) whoWeAre.push(`Our registered office is at ${address.join(', ')}.`);
  whoWeAre.push(
    'This policy explains what data we collect, why, who we share it with and what you can ask us to do with it. It explains your rights under the Digital Personal Data Protection Act, 2023.',
  );

  const officer = officerName
    ? `Our grievance officer is ${officerName}. Write to them at ${grievanceMail}.`
    : `Write to our grievance officer at ${grievanceMail}.`;
  const grievance = [
    officer,
    'We acknowledge every complaint within 48 hours and resolve it within 15 days.',
  ];
  if (address.length > 0) grievance.push(`You can also write to us at ${name}, ${address.join(', ')}.`);
  grievance.push(`For everyday help, write to ${supportMail} or see our [contact page](/contact).`);

  return {
    updatedOn: '2026-11-12',
    sections: [
      { id: 'who-we-are', heading: 'Who we are', paragraphs: whoWeAre },
      {
        id: 'what-we-collect',
        heading: 'What we collect',
        bullets: [
          'Account details: your name, mobile number, email address and password, and your business name, type, address and GSTIN.',
          'Business records you enter: bills, estimates, customers, suppliers, items and stock, payments, expenses, staff details, attendance and salary.',
          'Payment records for your Khatario plan: the amount, date, status and the reference number from the payment gateway. You type card or bank details only on the payment gateway\'s own page. Card numbers never reach Khatario.',
          'Device and usage data: your IP address, browser and device details, and a log of actions taken in your account, such as who created or changed a bill.',
          'Staff check-in data, when your business uses staff attendance: the phone\'s location and how accurate it is, whether a fake-location app is on, the names and IDs of nearby Wi-Fi networks, and whether the phone is rooted, an emulator or has developer options or USB debugging turned on.',
          'Face check data, only when your business turns on face check and the staff member agrees: photos taken at enrolment and check-in, and a face template made from them. Face matching runs on our own servers.',
          'Messages you send or receive through Khatario\'s WhatsApp features, and the phone numbers of the people you message.',
        ],
      },
      {
        id: 'why-we-use-it',
        heading: 'Why we use it',
        paragraphs: ['We use your data only for these purposes:'],
        bullets: [
          'To run Khatario for you: make bills, keep stock, run your online store, send your WhatsApp messages and record staff attendance.',
          'To create your account and let you log in, including sending login and sign-up codes on WhatsApp, and codes on WhatsApp and by email to reset a password.',
          'To take payment for your plan and send you receipts and reminders about your plan.',
          'To stop fake check-ins: location, Wi-Fi and phone checks tell your business whether a check-in really happened at the workplace.',
          'To keep accounts safe, stop misuse and find and fix problems.',
          'To answer your questions and give support.',
          'To tell you about changes to Khatario.',
        ],
      },
      {
        id: 'who-we-share-with',
        heading: 'Who we share it with',
        paragraphs: [
          'We share data only with the services we need to run Khatario, and only the part each one needs. We do not sell your data or your customers\' data.',
        ],
        bullets: [
          'Hosting: our servers are with Hostinger. Cloudflare provides our domain name service.',
          'Payment gateway: Razorpay or Easebuzz handle payments for your Khatario plan.',
          'WhatsApp (Meta): when you use WhatsApp features, your messages and the numbers you message go through WhatsApp. We also send login and sign-up codes on WhatsApp.',
          'AI providers: when you scan a bill, ask a question in Ask Khatario or use other AI features, the text or image for that request goes to Groq or Google (Gemini and Cloud Vision) to be read or answered.',
          'Email: an email delivery service sends our emails, such as password reset codes and plan reminders.',
          'Push notifications: Google Firebase delivers notifications to the Khatario apps.',
          'GST number checks: when a GSTIN is entered, we check it with public GST number lookup services and the government GST portal.',
          'Maps: when you set an office location for staff check-in, we look up its street address on OpenStreetMap.',
          'Meta (Facebook): when you finish signing up on our website, we may tell Meta that a sign-up happened, so we can measure our ads.',
          'Services you connect yourself: if you connect your own payment gateway, AI key, email account, Google Drive or Dropbox for backups, or a delivery service such as Shiprocket, the data needed for that service goes to it. Their own terms apply.',
          'The law: we share data when a court, the police or another authority lawfully asks for it.',
        ],
      },
      {
        id: 'your-customers-data',
        heading: "Your customers' and staff's data",
        paragraphs: [
          'When you add your customers, suppliers or staff to Khatario, or shoppers order from your online store, you own that data. We process it only for you, to run Khatario as you ask.',
          'You decide what you collect from them and what you do with it. Please tell them how you use their data and get their agreement where the law asks for it, for example before sending WhatsApp marketing messages or turning on face check for staff.',
          'If one of your customers or staff asks us about their data, we will pass the request to you.',
        ],
      },
      {
        id: 'retention-and-deletion',
        heading: 'How long we keep data and how to delete it',
        paragraphs: [
          'We keep your data while your account is open, so your records are there when you need them.',
          'You can download a full copy of your business data at any time from Settings, then Backup and restore.',
          'To close your account and delete your data, write to the grievance contact below. We will confirm the request with you, then permanently delete your business data. We may keep records the law requires us to keep.',
          'When a staff member leaves or withdraws consent, your business can delete their face check data, and it is removed from our servers.',
          'Scheduled backups saved to your Google Drive or Dropbox stay in your own account. You delete them there.',
        ],
      },
      {
        id: 'your-rights',
        heading: 'Your rights',
        paragraphs: [
          `Under the Digital Personal Data Protection Act, 2023, you have the rights listed below. To use any of them, write to ${grievanceMail}. We will reply within the timelines given in the grievance section.`,
        ],
        bullets: [
          'Access: ask what personal data we hold about you and how we use it.',
          'Correction: ask us to correct data that is wrong or out of date. You can change most details yourself in the app.',
          'Erasure: ask us to delete your personal data when it is no longer needed.',
          'Grievance: complain to us if you think we have handled your data wrongly.',
        ],
      },
      {
        id: 'cookies',
        heading: 'Cookies',
        paragraphs: [
          'We use cookies to keep you logged in and to remember your session. Without them, the app cannot work.',
          'When you finish signing up on our website, Meta\'s pixel may set a cookie so we can measure our ads. We do not use other advertising or tracking cookies.',
        ],
      },
      {
        id: 'children',
        heading: 'Children',
        paragraphs: [
          'Khatario is made for businesses. It is not meant for anyone under 18, and we do not knowingly collect data about children.',
        ],
      },
      {
        id: 'changes',
        heading: 'Changes to this policy',
        paragraphs: [
          'We may update this policy when Khatario or the law changes. We will post the new version on this page with a new date. If a change is important, we will also tell you in the app or by email.',
        ],
      },
      { id: 'grievance-officer', heading: 'Grievance officer and contact', paragraphs: grievance },
    ],
  };
}
