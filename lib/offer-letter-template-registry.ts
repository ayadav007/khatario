export type OfferLetterTemplateMeta = {
  id: string;
  name: string;
  description: string;
  features: string[];
  /** Suggested defaults when first activating this layout */
  suggested_settings?: Partial<{
    show_watermark: boolean;
    show_ctc_breakdown: boolean;
    body_intro: string;
  }>;
};

export const OFFER_LETTER_TEMPLATE_REGISTRY: OfferLetterTemplateMeta[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'Balanced formal letter with bordered tables — works for most companies.',
    features: ['Centered letterhead', 'CTC table', 'Dual signature blocks'],
  },
  {
    id: 'formal',
    name: 'Formal',
    description: 'Traditional corporate style with strong borders and serif typography.',
    features: ['Heavy borders', 'Underlined subject', 'Conservative layout'],
    suggested_settings: {
      show_watermark: true,
      show_ctc_breakdown: true,
      body_intro:
        'Further to our discussions, we are pleased to extend this offer of employment with {{business.name}} on the terms set out below.',
    },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Clean sans-serif layout with simple lists — easy to scan.',
    features: ['No heavy tables', 'Spacious typography', 'Print-friendly'],
    suggested_settings: {
      show_watermark: false,
      show_ctc_breakdown: false,
    },
  },
  {
    id: 'startup',
    name: 'Startup',
    description: 'Modern accent stripe and friendly tone for growing teams.',
    features: ['Accent sidebar', 'Rounded panels', 'Modern sans-serif'],
    suggested_settings: {
      show_watermark: false,
      show_ctc_breakdown: true,
      body_intro:
        'We’re excited to offer you a role at {{business.name}}! Here’s everything you need to know about joining our team.',
    },
  },
];

export function getOfferLetterTemplateMeta(templateId: string): OfferLetterTemplateMeta | undefined {
  return OFFER_LETTER_TEMPLATE_REGISTRY.find((t) => t.id === templateId);
}

export function isValidOfferLetterTemplateId(templateId: string): boolean {
  return OFFER_LETTER_TEMPLATE_REGISTRY.some((t) => t.id === templateId);
}

export const DEFAULT_OFFER_LETTER_TEMPLATE_ID = 'standard';
