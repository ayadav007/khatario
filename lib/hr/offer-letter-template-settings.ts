import { queryOne } from '@/lib/db';

export type OfferLetterTemplateSettings = {
  show_watermark: boolean;
  show_ctc_breakdown: boolean;
  body_intro: string;
  probation_clause: string;
  notice_period_clause: string;
  additional_terms: string;
  authorized_signatory_name: string;
  authorized_signatory_title: string;
  footer_text: string;
};

export const DEFAULT_OFFER_LETTER_TEMPLATE_SETTINGS: OfferLetterTemplateSettings = {
  show_watermark: true,
  show_ctc_breakdown: true,
  body_intro:
    'We are pleased to offer you employment with {{business.name}} on the terms and conditions set forth below.',
  probation_clause:
    'You will be on probation for {{offer.probation_months}} month(s) from your date of joining.',
  notice_period_clause:
    'During employment and after confirmation, your notice period shall be {{offer.notice_period_days}} days.',
  additional_terms: '',
  authorized_signatory_name: '',
  authorized_signatory_title: 'Authorized Signatory',
  footer_text: '',
};

export function parseOfferLetterTemplateSettings(raw: unknown): OfferLetterTemplateSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_OFFER_LETTER_TEMPLATE_SETTINGS };
  const o = raw as Record<string, unknown>;
  const d = DEFAULT_OFFER_LETTER_TEMPLATE_SETTINGS;
  return {
    show_watermark: o.show_watermark !== false,
    show_ctc_breakdown: o.show_ctc_breakdown !== false,
    body_intro: String(o.body_intro ?? d.body_intro),
    probation_clause: String(o.probation_clause ?? d.probation_clause),
    notice_period_clause: String(o.notice_period_clause ?? d.notice_period_clause),
    additional_terms: String(o.additional_terms ?? ''),
    authorized_signatory_name: String(o.authorized_signatory_name ?? ''),
    authorized_signatory_title: String(o.authorized_signatory_title ?? d.authorized_signatory_title),
    footer_text: String(o.footer_text ?? ''),
  };
}

export async function getOfferLetterTemplateSettings(
  businessId: string,
): Promise<{ template_id: string; settings: OfferLetterTemplateSettings }> {
  const row = await queryOne<{ template_id: string; settings: unknown }>(
    `SELECT template_id, settings FROM business_template_assignments
     WHERE business_id = $1 AND document_type = 'offer_letter'`,
    [businessId],
  );
  return {
    template_id: row?.template_id ?? 'standard',
    settings: parseOfferLetterTemplateSettings(row?.settings),
  };
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => vars[key.trim()] ?? '');
}

export function applyOfferLetterTextSettings(
  settings: OfferLetterTemplateSettings,
  vars: Record<string, string>,
): OfferLetterTemplateSettings {
  return {
    ...settings,
    body_intro: interpolate(settings.body_intro, vars),
    probation_clause: interpolate(settings.probation_clause, vars),
    notice_period_clause: interpolate(settings.notice_period_clause, vars),
    additional_terms: interpolate(settings.additional_terms, vars),
  };
}
