/**

 * Single source of truth for Integrations & Marketplace listings.

 * External connectors and billing-channel add-ons only — not first-party products (HR, Connect CRM).

 * Enable products on Settings → Your products; configure modules under Module settings.

 */



import { FeatureKeys } from '@/lib/featureKeys';

import type { PlatformModule } from '@/lib/platform-modules';



export type IntegrationCategory = 'billing' | 'sms' | 'ai' | 'crm';



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

  /** When set, hide this row unless the business has this platform module enabled. */

  requiredPlatformModule?: PlatformModule;

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

    id: 'whatsapp-invoice-send',

    category: 'billing',

    title: 'Send invoices on WhatsApp',

    shortDescription:

      'Link your WhatsApp number and send invoices, estimates, and payment reminders from billing. This is separate from the Connect inbox and bot product.',

    icon: 'MessageSquare',

    configureHref: '/connect/whatsapp',

    featureKeys: ['settings_whatsapp'],

    ctaVariant: 'connect',

    requiredPlatformModule: 'billing',

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

  billing: 'Billing channels',

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



export function filterCatalogByPlatformModules(

  entries: IntegrationCatalogEntry[],

  enabledModules: PlatformModule[],

): IntegrationCatalogEntry[] {

  return entries.filter((entry) => {

    if (!entry.requiredPlatformModule) return true;

    return enabledModules.includes(entry.requiredPlatformModule);

  });

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

  'billing',

  'sms',

  'ai',

  'crm',

] as const;



export type MarketplaceCategoryParam = (typeof MARKETPLACE_CATEGORY_PARAMS)[number];



export function normalizeCategoryParam(raw: string | null): MarketplaceCategoryParam {

  if (!raw) return 'all';

  const lower = raw.toLowerCase();

  // Legacy URLs

  if (lower === 'whatsapp') return 'billing';

  if (lower === 'hr') return 'all';

  if (MARKETPLACE_CATEGORY_PARAMS.includes(lower as MarketplaceCategoryParam)) {

    return lower as MarketplaceCategoryParam;

  }

  return 'all';

}


