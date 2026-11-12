/**

 * Single source of truth for Integrations & Marketplace listings.

 * External connectors and billing-channel add-ons only — not first-party products (HR, Connect CRM).

 * Enable products on Settings → Your products; configure modules under Module settings.

 */



import { FeatureKeys } from '@/lib/featureKeys';

import type { PlatformModule } from '@/lib/platform-modules';



export type IntegrationCategory = 'billing' | 'sms' | 'ai' | 'crm' | 'shipping';



export type IntegrationCtaVariant = 'connect' | 'access' | 'try';



/** Lucide icon names resolved in the UI layer */

export type IntegrationIconKey =

  | 'MessageSquare'

  | 'Zap'

  | 'Bot'

  | 'Users'

  | 'Smartphone'

  | 'Building2'

  | 'Mail'

  | 'Truck';



export type PluginFieldKind = 'text' | 'email' | 'password' | 'webhook_token';

export type PluginField = {
  key: string;
  label: string;
  help?: string;
  kind: PluginFieldKind;
  required: boolean;
};

export type IntegrationPlugin = {
  provider: string;
  overview: string[];
  setupSteps: string[];
  faq: { q: string; a: string }[];
  fields: PluginField[];
};

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

  /** Setup page content for connectors saved through the plugin routes. */

  plugin?: IntegrationPlugin;

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

    configureHref: '/settings/whatsapp',

    featureKeys: ['settings_whatsapp'],

    ctaVariant: 'connect',

    requiredPlatformModule: 'billing',

  },

  {

    id: 'ai-sales-agent',

    category: 'ai',

    title: 'AI Sales Agent',

    shortDescription:

      'A WhatsApp AI agent that answers customers from your catalogue and FAQs, takes orders and hands over to your team.',

    icon: 'Zap',

    configureHref: '/settings/whatsapp/ai-agent',

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

  {

    id: 'shiprocket',

    category: 'shipping',

    title: 'Shiprocket',

    shortDescription:

      'Book couriers, print labels and manifests, and track parcels through your Shiprocket account.',

    icon: 'Truck',

    featureKeys: [],

    ctaVariant: 'connect',

    plugin: {

      provider: 'shiprocket',

      overview: [

        'Connect your own Shiprocket account and Khatario shows courier rates to your customers at checkout, using the pickup address you set in Shiprocket.',

        'From Orders you can book a courier, print the label and the manifest, and see where each parcel is. Tracking updates from Shiprocket reach Khatario on their own, so your team and your customers see the latest status.',

        'When a delivery fails you can choose what happens next, and you can book a return pickup for a parcel that is coming back.',

      ],

      setupSteps: [

        'In Shiprocket, open Settings, then API, and create an API user. Use a new email for it, not your main login.',

        'Enter that API user email and password here and save.',

        'Generate the tracking webhook token here, then paste the token and the address shown into Shiprocket under Settings, then API, then Webhooks.',

        'In Shiprocket, add at least one pickup address so couriers know where to collect parcels.',

      ],

      faq: [

        {

          q: 'Why not my main Shiprocket login?',

          a: 'Shiprocket gives API access only to an API user. It also keeps your main login private, and you can remove the API user at any time without changing your main account.',

        },

        {

          q: 'What does it cost?',

          a: 'Khatario adds no charge for this connection. You pay Shiprocket and the couriers at your Shiprocket rates.',

        },

        {

          q: 'Can I disconnect?',

          a: 'Yes. Disconnect from this page and Khatario forgets the login and the token. Your Shiprocket account is not touched.',

        },

        {

          q: 'What happens to parcels already booked?',

          a: 'They stay booked with Shiprocket and the courier. Khatario simply stops getting tracking updates and cannot book new parcels until you connect again.',

        },

      ],

      fields: [

        {

          key: 'email',

          label: 'API user email',

          help: 'The API user you create in Shiprocket under Settings → API. Not your main Shiprocket login.',

          kind: 'email',

          required: true,

        },

        {

          key: 'password',

          label: 'API user password',

          kind: 'password',

          required: true,

        },

        {

          key: 'webhook_token',

          label: 'Tracking webhook token',

          help: 'Paste this token and the address above into Shiprocket under Settings → API → Webhooks, so parcel updates reach Khatario.',

          kind: 'webhook_token',

          required: false,

        },

      ],

    },

  },

  {

    id: 'delhivery',

    category: 'shipping',

    title: 'Delhivery',

    shortDescription: 'Book and track Delhivery parcels from Orders.',

    icon: 'Truck',

    comingSoon: true,

    featureKeys: [],

    ctaVariant: 'connect',

  },

  {

    id: 'nimbuspost',

    category: 'shipping',

    title: 'NimbusPost',

    shortDescription: 'Book and track NimbusPost parcels from Orders.',

    icon: 'Truck',

    comingSoon: true,

    featureKeys: [],

    ctaVariant: 'connect',

  },

  {

    id: 'ithink-logistics',

    category: 'shipping',

    title: 'iThink Logistics',

    shortDescription: 'Book and track iThink Logistics parcels from Orders.',

    icon: 'Truck',

    comingSoon: true,

    featureKeys: [],

    ctaVariant: 'connect',

  },

  {

    id: 'porter',

    category: 'shipping',

    title: 'Porter',

    shortDescription: 'Send local deliveries with Porter from Orders.',

    icon: 'Truck',

    comingSoon: true,

    featureKeys: [],

    ctaVariant: 'connect',

  },

  {

    id: 'borzo',

    category: 'shipping',

    title: 'Borzo',

    shortDescription: 'Send same day local deliveries with Borzo from Orders.',

    icon: 'Truck',

    comingSoon: true,

    featureKeys: [],

    ctaVariant: 'connect',

  },

];



const CATEGORY_LABELS: Record<IntegrationCategory | 'all', string> = {

  all: 'All integrations',

  billing: 'Billing channels',

  sms: 'SMS',

  ai: 'AI',

  crm: 'CRM',

  shipping: 'Shipping',

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

  'shipping',

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



export function getPluginEntry(
  id: string,
): (IntegrationCatalogEntry & { plugin: IntegrationPlugin }) | null {
  const entry = INTEGRATION_CATALOG.find((e) => e.id === id);
  if (!entry || !entry.plugin) return null;
  return entry as IntegrationCatalogEntry & { plugin: IntegrationPlugin };
}
