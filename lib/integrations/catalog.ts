/**
 * Single source of truth for Integrations & Marketplace listings.
 * Add new rows here (and optional sidebar category) — no layout changes required.
 */

import { FeatureKeys } from '@/lib/featureKeys';

export type IntegrationCategory = 'whatsapp' | 'hr' | 'sms' | 'ai' | 'crm';

export type IntegrationCtaVariant = 'connect' | 'access' | 'try';

/** Lucide icon names resolved in the UI layer */
export type IntegrationIconKey =
  | 'MessageSquare'
  | 'Zap'
  | 'Bot'
  | 'Users'
  | 'Smartphone'
  | 'Building2'
  | 'Mail';

export interface IntegrationCatalogEntry {
  id: string;
  category: IntegrationCategory;
  title: string;
  shortDescription: string;
  learnMoreUrl?: string;
  icon: IntegrationIconKey;
  /** Settings path when integration is configurable */
  configureHref?: string;
  /** If true, show Coming soon and disable primary CTA */
  comingSoon?: boolean;
  /**
   * Plan / registry feature IDs for entitlement (unless comingSoon).
   * Empty = no plan gate (still may use connection status for Active).
   * Use featureKeysMatch: 'any' when one of several keys is enough (e.g. WhatsApp manual or bot).
   */
  featureKeys: string[];
  featureKeysMatch?: 'all' | 'any';
  /** Preferred CTA when not active and entitled */
  ctaVariant: IntegrationCtaVariant;
}

export const INTEGRATION_CATALOG: IntegrationCatalogEntry[] = [
  {
    id: 'email-smtp',
    category: 'sms',
    title: 'Email (SMTP)',
    shortDescription:
      'Send invoices, purchase orders, and payment reminders from your own mail server. Configure Gmail, Outlook, or custom SMTP per business.',
    icon: 'Mail',
    configureHref: '/settings/email',
    featureKeys: [FeatureKeys.EMAIL_INVOICING, FeatureKeys.EMAIL_REMINDERS],
    featureKeysMatch: 'any',
    ctaVariant: 'connect',
  },
  {
    id: 'whatsapp',
    category: 'whatsapp',
    title: 'WhatsApp',
    shortDescription:
      'Send invoices, payment reminders, and documents on WhatsApp. Connect your business number and reach customers where they already chat.',
    icon: 'MessageSquare',
    configureHref: '/settings/whatsapp',
    featureKeys: ['integration_whatsapp_manual', 'integration_whatsapp_bot'],
    featureKeysMatch: 'any',
    ctaVariant: 'connect',
  },
  {
    id: 'ai-sales-agent',
    category: 'ai',
    title: 'AI Sales Agent',
    shortDescription:
      'Configure an AI chatbot with your own API keys to assist on sales conversations and routine replies.',
    icon: 'Zap',
    configureHref: '/settings/ai-config',
    featureKeys: [],
    ctaVariant: 'try',
  },
  {
    id: 'ai-assistant',
    category: 'ai',
    title: 'AI Assistant',
    shortDescription:
      'Tune in-app AI assistant behavior, prompts, and defaults for your team.',
    icon: 'Bot',
    configureHref: '/settings/ai-assistant',
    featureKeys: [],
    ctaVariant: 'try',
  },
  {
    id: 'hr-suite',
    category: 'hr',
    title: 'HR & team',
    shortDescription:
      'Manage users, roles, shifts, leave types, and holidays. Central hub for people and access settings.',
    icon: 'Users',
    configureHref: '/settings/user-management',
    featureKeys: [],
    ctaVariant: 'access',
  },
  {
    id: 'sms',
    category: 'sms',
    title: 'SMS messaging',
    shortDescription:
      'Send transactional SMS for invoices, OTPs, and alerts. Provider setup and templates will be available here.',
    icon: 'Smartphone',
    comingSoon: true,
    featureKeys: [],
    ctaVariant: 'try',
  },
];

const CATEGORY_LABELS: Record<IntegrationCategory | 'all', string> = {
  all: 'All integrations',
  whatsapp: 'WhatsApp',
  hr: 'HR',
  sms: 'SMS',
  ai: 'AI',
  crm: 'CRM',
};

export function getCategoryLabel(category: string): string {
  if (category === 'all') return CATEGORY_LABELS.all;
  return CATEGORY_LABELS[category as IntegrationCategory] ?? 'Integrations';
}

export function filterCatalogByCategory(
  category: string
): IntegrationCatalogEntry[] {
  if (!category || category === 'all') {
    return [...INTEGRATION_CATALOG];
  }
  return INTEGRATION_CATALOG.filter((e) => e.category === category);
}

export function searchCatalog(
  entries: IntegrationCatalogEntry[],
  query: string
): IntegrationCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      e.shortDescription.toLowerCase().includes(q)
  );
}

/** Valid ?category= values for the marketplace URL */
export const MARKETPLACE_CATEGORY_PARAMS = [
  'all',
  'whatsapp',
  'hr',
  'sms',
  'ai',
  'crm',
] as const;

export type MarketplaceCategoryParam = (typeof MARKETPLACE_CATEGORY_PARAMS)[number];

export function normalizeCategoryParam(raw: string | null): MarketplaceCategoryParam {
  if (!raw) return 'all';
  const lower = raw.toLowerCase();
  if (MARKETPLACE_CATEGORY_PARAMS.includes(lower as MarketplaceCategoryParam)) {
    return lower as MarketplaceCategoryParam;
  }
  return 'all';
}
