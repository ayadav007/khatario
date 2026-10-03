import { queryRows } from '@/lib/db';
import {
  createPlatformWhatsAppDraft,
  listPlatformWhatsAppTemplates,
  type PlatformWaEventKey,
  type PlatformWhatsAppTemplate,
} from '@/lib/platform-whatsapp-templates';

/**
 * Starter WhatsApp templates for follow-ups sent outside the 24-hour window.
 * Quick-reply labels match option titles in the default flow, so a tap continues the flow.
 * Body variable {{1}} is always the lead's first name.
 */
export type FunnelTemplateSeed = {
  event_key: PlatformWaEventKey;
  name: string;
  category: 'MARKETING' | 'UTILITY';
  header_format: 'none' | 'image' | 'video';
  header_media_key: string | null;
  body_text: string;
  footer_text: string | null;
  example_vars: string[];
  quick_replies: string[];
  purpose: string;
};

const OPT_OUT_FOOTER = 'Reply STOP to stop messages';

export const FUNNEL_TEMPLATES: FunnelTemplateSeed[] = [
  {
    event_key: 'funnel_reengage',
    name: 'khatario_funnel_reengage_v1',
    category: 'MARKETING',
    header_format: 'image',
    header_media_key: 'sales_list',
    body_text:
      'Hi {{1}}, are you still looking for an easier way to manage billing, GST and stock?\n\n' +
      'Khatario helps shops, wholesalers and distributors create GST invoices in seconds, track stock and collect payments faster.\n\n' +
      'Would you like to see a quick demo?',
    footer_text: OPT_OUT_FOOTER,
    example_vars: ['Ramesh'],
    quick_replies: ['Watch Demo', 'Start Free Trial', 'Talk to Expert'],
    purpose: 'Lead stopped replying for 2 days before starting a trial',
  },
  {
    event_key: 'funnel_demo_no_trial',
    name: 'khatario_funnel_demo_no_trial_v1',
    category: 'MARKETING',
    header_format: 'image',
    header_media_key: 'invoice_new',
    body_text:
      'Hi {{1}}, did you get a chance to watch the Khatario demo?\n\n' +
      'Try it with your own business. Setup takes about 2 minutes, and our team can help you create your first GST invoice.',
    footer_text: OPT_OUT_FOOTER,
    example_vars: ['Ramesh'],
    quick_replies: ['Start Free Trial', 'Talk to Expert'],
    purpose: 'Demo sent but no trial after a day',
  },
  {
    event_key: 'funnel_first_invoice',
    name: 'khatario_funnel_first_invoice_v1',
    category: 'UTILITY',
    header_format: 'image',
    header_media_key: 'invoice_new',
    body_text:
      'Hello {{1}}, your Khatario account is ready.\n\n' +
      'To create your first invoice, open Sales, tap New invoice, pick a customer, add items and save.\n\n' +
      'Reply HELP if you want our team to help you set up.',
    footer_text: null,
    example_vars: ['Ramesh'],
    quick_replies: ['HELP'],
    purpose: 'Trial created but no invoice yet',
  },
  {
    event_key: 'funnel_trial_inactive',
    name: 'khatario_funnel_trial_inactive_v1',
    category: 'UTILITY',
    header_format: 'none',
    header_media_key: null,
    body_text:
      'Hi {{1}}, you have not created an invoice in your Khatario trial yet.\n\n' +
      'Is something holding you back? Reply to this message and our team will help you get started.',
    footer_text: null,
    example_vars: ['Ramesh'],
    quick_replies: ['Talk to Expert'],
    purpose: 'Trial still unused after 5 days',
  },
  {
    event_key: 'funnel_trial_feature',
    name: 'khatario_funnel_trial_feature_v1',
    category: 'MARKETING',
    header_format: 'image',
    header_media_key: 'invoice_items',
    body_text:
      'Great work {{1}}, you are already billing with Khatario.\n\n' +
      'Tip: turn on payment reminders and low-stock alerts so Khatario keeps working for you every day.',
    footer_text: OPT_OUT_FOOTER,
    example_vars: ['Ramesh'],
    quick_replies: ['Talk to Expert'],
    purpose: 'Activated trial, day 7 feature tip (header image changes with the pain point)',
  },
  {
    event_key: 'funnel_handover',
    name: 'khatario_funnel_handover_v1',
    category: 'UTILITY',
    header_format: 'none',
    header_media_key: null,
    body_text:
      'Hi {{1}}, thank you for your interest in Khatario.\n\n' +
      'Our expert will call you on this number shortly to help you get started.',
    footer_text: null,
    example_vars: ['Ramesh'],
    quick_replies: [],
    purpose: 'Sales team reaching a lead outside the 24-hour window',
  },
];

export const FUNNEL_EVENT_KEYS = FUNNEL_TEMPLATES.map((t) => t.event_key);

export async function listFunnelTemplates(): Promise<PlatformWhatsAppTemplate[]> {
  const all = await listPlatformWhatsAppTemplates();
  return all.filter((t) => t.event_key && (FUNNEL_EVENT_KEYS as string[]).includes(t.event_key));
}

/** Creates draft rows for funnel templates that have no template yet (by event or name). */
export async function seedFunnelTemplates(createdBy: string | null): Promise<{ created: string[]; skipped: string[] }> {
  const existing = await queryRows<{ name: string; event_key: string | null }>(
    `SELECT name, event_key FROM platform_whatsapp_templates`,
  );
  const names = new Set(existing.map((r) => r.name));
  const events = new Set(existing.map((r) => r.event_key).filter(Boolean));
  const created: string[] = [];
  const skipped: string[] = [];
  for (const t of FUNNEL_TEMPLATES) {
    if (names.has(t.name) || events.has(t.event_key)) {
      skipped.push(t.name);
      continue;
    }
    await createPlatformWhatsAppDraft({
      name: t.name,
      language: 'en_US',
      category: t.category,
      body_text: t.body_text,
      footer_text: t.footer_text,
      example_vars: t.example_vars,
      event_key: t.event_key,
      header_format: t.header_format,
      header_media_key: t.header_media_key,
      quick_replies: t.quick_replies,
      created_by: createdBy,
    });
    created.push(t.name);
  }
  return { created, skipped };
}
