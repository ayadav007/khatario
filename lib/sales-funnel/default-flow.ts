import type { FlowDefinition, FlowMessage, FlowOption } from './definition';

/**
 * Version 1 of the Meta ads WhatsApp sales flow. Seeded as the first published version; admins
 * edit copy, options and routing from Admin > Sales flow without code changes.
 */

export const BUSINESS_TYPES: Array<{ value: string; label: string; signupType: string; signupIndustry: string }> = [
  { value: 'retail', label: 'Retail / Kirana store', signupType: 'retail', signupIndustry: 'other' },
  { value: 'wholesale', label: 'Wholesale / Distribution', signupType: 'wholesaler', signupIndustry: 'other' },
  { value: 'trading', label: 'Trading business', signupType: 'distributor', signupIndustry: 'other' },
  { value: 'manufacturing', label: 'Manufacturing', signupType: 'manufacturer', signupIndustry: 'other' },
  { value: 'restaurant', label: 'Restaurant / Food business', signupType: 'retail', signupIndustry: 'food_beverages' },
  { value: 'other', label: 'Other business', signupType: 'other', signupIndustry: 'other' },
];

export const PAIN_POINTS: Array<{ value: string; label: string }> = [
  { value: 'billing_speed', label: 'Billing takes too much time' },
  { value: 'gst_accounting', label: 'GST and accounting' },
  { value: 'inventory', label: 'Stock / inventory management' },
  { value: 'outstanding', label: 'Tracking customer outstanding' },
  { value: 'multi_activity', label: 'Managing many business activities' },
  { value: 'switching', label: 'Using another billing software' },
];

const CTA: FlowOption[] = [
  { id: 'cta_demo', title: 'Watch Demo', next: 'demo', keywords: ['demo', 'video', 'watch', 'dekhna', 'dikhao'] },
  { id: 'cta_trial', title: 'Start Free Trial', next: 'trial_business_name', keywords: ['trial', 'free', 'start', 'signup', 'sign up', 'account', 'try'] },
  { id: 'cta_expert', title: 'Talk to Expert', next: 'handoff', keywords: ['expert', 'call', 'talk', 'baat', 'person', 'human', 'sales'] },
];

function pitch(body: string, footer = 'Free trial. No card needed.'): FlowMessage[] {
  return [{ type: 'buttons', body, footer, options: CTA }];
}

const PITCH_BY_PAIN: Record<string, string> = {
  billing_speed:
    'Got it! Slow billing means long queues and lost time every day.\n\nWith Khatario you get:\n✅ GST invoices in seconds with item search and barcode\n✅ Saved customers and prices, so no retyping\n✅ Share invoices on WhatsApp instantly\n✅ Works on mobile and computer\n\nWould you like to see how Khatario works?',
  gst_accounting:
    'Got it! Managing GST and accounts manually takes a lot of time.\n\nKhatario helps you manage:\n✅ Sales and purchase entries\n✅ GST-enabled invoicing\n✅ Customer and supplier ledgers\n✅ Inventory management\n✅ GST and business reports\n\nYou can manage your daily business operations from one place.\n\nWould you like to see how Khatario works?',
  inventory:
    'Got it! Not knowing your exact stock leads to lost sales and dead stock.\n\nKhatario keeps stock right automatically:\n✅ Stock updates with every sale and purchase\n✅ Low-stock alerts\n✅ Item-wise and branch-wise stock reports\n✅ Barcodes and item categories\n\nWould you like to see how Khatario works?',
  outstanding:
    'Got it! Unpaid dues quietly eat into your cash flow.\n\nKhatario helps you collect faster:\n✅ Customer-wise outstanding and ledger\n✅ Payment reminders on WhatsApp\n✅ Record part payments easily\n✅ Ageing reports to see who owes what\n\nWould you like to see how Khatario works?',
  multi_activity:
    'Got it! Juggling billing, stock, payments and accounts in different places is exhausting.\n\nKhatario brings it together:\n✅ Billing, purchases and expenses\n✅ Stock and inventory\n✅ Customer and supplier ledgers\n✅ Staff access and branches\n✅ Reports in one dashboard\n\nWould you like to see how Khatario works?',
  switching:
    'Got it! Switching software should not mean starting from zero.\n\nWith Khatario:\n✅ Import your items and customers\n✅ Set opening balances and stock\n✅ GST invoicing, inventory and accounts in one app\n✅ Our team helps you move over\n\nWould you like to see how Khatario works?',
};

const PITCH_COMBOS: Array<{ business_type: string; pain_point: string; body: string }> = [
  {
    business_type: 'restaurant',
    pain_point: 'billing_speed',
    body: 'Got it! At a busy counter, every second of billing counts.\n\nKhatario helps food businesses with:\n✅ Fast billing with saved menu items\n✅ GST-ready bills\n✅ Daily sales and stock of ingredients\n✅ Simple business reports\n\nWould you like to see how Khatario works?',
  },
  {
    business_type: 'wholesale',
    pain_point: 'outstanding',
    body: 'Got it! In wholesale, party outstanding can get out of hand quickly.\n\nKhatario gives you:\n✅ Party ledger and outstanding at a glance\n✅ Bulk billing with party-wise prices\n✅ Payment reminders on WhatsApp\n✅ Credit limits and ageing reports\n\nWould you like to see how Khatario works?',
  },
  {
    business_type: 'retail',
    pain_point: 'inventory',
    body: 'Got it! In a shop, knowing what is in stock decides your sales.\n\nKhatario helps your store with:\n✅ Fast billing that updates stock automatically\n✅ Low-stock alerts before you run out\n✅ Barcode support\n✅ Item-wise sales and stock reports\n\nWould you like to see how Khatario works?',
  },
  {
    business_type: 'manufacturing',
    pain_point: 'inventory',
    body: 'Got it! Manufacturing means tracking raw material and finished goods.\n\nKhatario helps with:\n✅ Purchase and stock of raw material\n✅ Finished goods inventory\n✅ GST invoices and accounting\n✅ Stock and profit reports\n\nWould you like to see how Khatario works?',
  },
  {
    business_type: 'trading',
    pain_point: 'gst_accounting',
    body: 'Got it! Trading means many purchases and sales to keep GST-correct.\n\nKhatario helps you manage:\n✅ Purchase, sales and stock in one place\n✅ GST invoicing and GST reports\n✅ Supplier and customer ledgers\n✅ Profit and loss at a glance\n\nWould you like to see how Khatario works?',
  },
];

const btOptions: FlowOption[] = [
  { id: 'bt_retail', title: 'Retail / Kirana Store', next: 'pain_point', set: { business_type: 'retail' }, keywords: ['retail', 'kirana', 'shop', 'store', 'dukaan', 'dukan'] },
  { id: 'bt_wholesale', title: 'Wholesale / Distribution', next: 'pain_point', set: { business_type: 'wholesale' }, keywords: ['wholesale', 'distribution', 'distributor', 'wholesaler'] },
  { id: 'bt_trading', title: 'Trading Business', next: 'pain_point', set: { business_type: 'trading' }, keywords: ['trading', 'trader', 'traders'] },
  { id: 'bt_manufacturing', title: 'Manufacturing', next: 'pain_point', set: { business_type: 'manufacturing' }, keywords: ['manufacturing', 'manufacturer', 'factory', 'production'] },
  { id: 'bt_restaurant', title: 'Restaurant / Food', description: 'Restaurant, cafe, sweets, bakery', next: 'pain_point', set: { business_type: 'restaurant' }, keywords: ['restaurant', 'hotel', 'cafe', 'food', 'dhaba', 'bakery', 'sweets'] },
  { id: 'bt_other', title: 'Other', next: 'pain_point', set: { business_type: 'other' }, keywords: ['other', 'service', 'services'] },
];

const ppOptions: FlowOption[] = [
  { id: 'pp_billing_speed', title: 'Billing takes too long', description: 'Slow billing, long queues', next: 'pitch', set: { pain_point: 'billing_speed' }, keywords: ['billing', 'bill', 'slow', 'time', 'fast'] },
  { id: 'pp_gst_accounting', title: 'GST and accounting', description: 'GST invoices, returns, books', next: 'pitch', set: { pain_point: 'gst_accounting' }, keywords: ['gst', 'accounting', 'accounts', 'tax', 'return', 'hisab'] },
  { id: 'pp_inventory', title: 'Stock / Inventory', description: 'Stock mismatch, dead stock', next: 'pitch', set: { pain_point: 'inventory' }, keywords: ['stock', 'inventory', 'maal', 'godown'] },
  { id: 'pp_outstanding', title: 'Customer outstanding', description: 'Udhaar, pending payments', next: 'pitch', set: { pain_point: 'outstanding' }, keywords: ['outstanding', 'udhaar', 'udhar', 'payment', 'due', 'credit', 'collection'] },
  { id: 'pp_multi_activity', title: 'Too many activities', description: 'Billing, stock, staff, accounts', next: 'pitch', set: { pain_point: 'multi_activity' }, keywords: ['many', 'everything', 'multiple', 'all'] },
  { id: 'pp_switching', title: 'Using other software', description: 'Tally, Vyapar, Busy, others', next: 'pitch', set: { pain_point: 'switching' }, keywords: ['tally', 'vyapar', 'busy', 'marg', 'software', 'switch', 'already'] },
];

const WELCOME_TAIL = "Let's understand your business in just 2 quick questions.";

export const DEFAULT_FLOW: FlowDefinition = {
  defaultEntry: 'general',
  entries: [
    {
      id: 'gst_ad',
      label: 'GST billing ad',
      step: 'welcome_gst',
      keywords: ['gst billing', 'gst invoice', 'know about gst'],
      set: { pain_point: 'gst_accounting' },
    },
    {
      id: 'inventory_ad',
      label: 'Inventory ad',
      step: 'welcome_inventory',
      keywords: ['manage my stock', 'stock', 'inventory'],
      set: { pain_point: 'inventory' },
    },
    {
      id: 'accounts_ad',
      label: 'Business accounting ad',
      step: 'welcome_accounts',
      keywords: ['business accounts', 'manage my business accounts', 'accounting'],
      set: { pain_point: 'outstanding' },
    },
    {
      id: 'whatsapp_billing_ad',
      label: 'WhatsApp billing ad',
      step: 'welcome_general',
      keywords: ['whatsapp billing', 'bill on whatsapp'],
      set: { pain_point: 'billing_speed' },
    },
    { id: 'general', label: 'General enquiry', step: 'welcome_general', keywords: ['know more about khatario', 'khatario'] },
  ],
  steps: [
    {
      id: 'welcome_general',
      label: 'Welcome (general)',
      messages: [
        {
          type: 'text',
          body: `👋 Hi{{name_suffix}}! Welcome to Khatario.\n\nLooking for an easier way to manage your business billing, GST, inventory and accounts?\n\nWe can help you simplify your daily business operations. ${WELCOME_TAIL}`,
        },
      ],
      next: 'business_type',
    },
    {
      id: 'welcome_gst',
      label: 'Welcome (GST billing ad)',
      messages: [
        {
          type: 'text',
          body: `👋 Hi{{name_suffix}}! Welcome to Khatario.\n\nKhatario makes GST billing simple: GST-ready invoices in seconds, automatic tax calculation and GST reports for filing.\n\nLet's see how it fits your business. Just one quick question first.`,
        },
      ],
      next: 'business_type',
    },
    {
      id: 'welcome_inventory',
      label: 'Welcome (inventory ad)',
      messages: [
        {
          type: 'text',
          body: `👋 Hi{{name_suffix}}! Welcome to Khatario.\n\nKhatario keeps your stock right automatically: every sale and purchase updates inventory, with low-stock alerts and item-wise reports.\n\nLet's see how it fits your business. Just one quick question first.`,
        },
      ],
      next: 'business_type',
    },
    {
      id: 'welcome_accounts',
      label: 'Welcome (accounting ad)',
      messages: [
        {
          type: 'text',
          body: `👋 Hi{{name_suffix}}! Welcome to Khatario.\n\nKhatario keeps your business accounts in one place: customer and supplier ledgers, outstanding, expenses and profit reports.\n\nLet's see how it fits your business. Just one quick question first.`,
        },
      ],
      next: 'business_type',
    },
    {
      id: 'business_type',
      label: 'Business type',
      messages: [
        {
          type: 'list',
          body: 'What type of business do you run?',
          buttonText: 'Choose business',
          options: btOptions,
        },
      ],
    },
    {
      id: 'pain_point',
      label: 'Biggest challenge',
      skipIfSet: 'pain_point',
      skipTo: 'pitch',
      messages: [
        {
          type: 'list',
          body: 'Thanks! What is your biggest challenge in managing your business?',
          buttonText: 'Choose challenge',
          options: ppOptions,
        },
      ],
    },
    {
      id: 'pitch',
      label: 'Personalised pitch',
      actions: ['mark_qualified'],
      messages: pitch(PITCH_BY_PAIN.multi_activity),
      variants: [
        ...PITCH_COMBOS.map((c) => ({
          when: { business_type: c.business_type, pain_point: c.pain_point },
          messages: pitch(c.body),
        })),
        ...Object.entries(PITCH_BY_PAIN).map(([pain_point, body]) => ({ when: { pain_point }, messages: pitch(body) })),
      ],
    },
    {
      id: 'demo',
      label: 'Demo video',
      actions: ['mark_demo_interested', 'mark_demo_sent'],
      messages: [
        {
          type: 'video',
          mediaKey: 'demo_video',
          caption: 'Here is Khatario in 90 seconds: create a GST invoice, track stock and see your business reports.',
          fallback: [
            { type: 'image', mediaKey: 'invoice_new', caption: 'Create a GST invoice in seconds' },
            { type: 'image', mediaKey: 'invoice_items', caption: 'Pick items, stock updates automatically' },
            { type: 'image', mediaKey: 'invoice_save', caption: 'Save and share on WhatsApp' },
          ],
        },
        {
          type: 'buttons',
          body: 'Would you like to try this with your own business? Setting up takes about 2 minutes.',
          options: [
            { id: 'demo_trial', title: 'Start Free Trial', next: 'trial_business_name', keywords: ['trial', 'yes', 'start', 'haan', 'ha', 'ok', 'try'] },
            { id: 'demo_expert', title: 'Talk to Expert', next: 'handoff', keywords: ['expert', 'call', 'talk', 'help'] },
          ],
        },
      ],
    },
    {
      id: 'trial_business_name',
      label: 'Trial: business name',
      actions: ['mark_demo_interested'],
      skipIfSet: 'business_name',
      skipTo: 'trial_owner_name',
      collect: 'business_name',
      messages: [
        { type: 'text', body: "Great choice! Let's set up your free Khatario trial.\n\nWhat is your business name?" },
      ],
      next: 'trial_owner_name',
    },
    {
      id: 'trial_owner_name',
      label: 'Trial: owner name',
      skipIfSet: 'owner_name',
      skipTo: 'trial_link',
      collect: 'owner_name',
      messages: [{ type: 'text', body: 'Thanks! And what is your name?' }],
      next: 'trial_link',
    },
    {
      id: 'trial_link',
      label: 'Trial: signup link',
      actions: ['send_signup_link'],
      terminal: true,
      messages: [
        {
          type: 'text',
          body: 'Thank you {{first_name}}! Your free trial for *{{business_name}}* is ready to set up.\n\nTap the link to create your account. Your details are already filled in and this WhatsApp number is verified, so it takes about a minute:\n{{signup_link}}\n\nAfter signing up, create your first invoice. We will guide you step by step.',
        },
        {
          type: 'buttons',
          body: 'Need any help while setting up?',
          options: [{ id: 'trial_help', title: 'Talk to Expert', next: 'handoff', keywords: ['help', 'expert', 'call'] }],
        },
      ],
    },
    {
      id: 'handoff',
      label: 'Talk to an expert',
      actions: ['handoff_to_sales'],
      terminal: true,
      messages: [
        {
          type: 'text',
          body: 'Thanks{{name_suffix}}! A Khatario expert will message you here shortly (Mon to Sat, 10 am to 7 pm).\n\nMeanwhile, tell us anything specific you would like to see, for example GST returns, stock or WhatsApp billing.',
        },
      ],
    },
  ],
  followups: [
    {
      kind: 'nudge_5m',
      label: 'Gentle reminder (5 minutes, no reply)',
      enabled: true,
      anchor: 'awaiting_reply',
      delayMinutes: 5,
      condition: 'no_reply',
      messages: [{ type: 'text', body: 'Just tap an option below so we can show you what fits your business best 🙂' }],
      repeatCurrentStep: true,
    },
    {
      kind: 'nudge_22h',
      label: 'Still exploring? (about 22 hours, no reply)',
      enabled: true,
      anchor: 'awaiting_reply',
      delayMinutes: 22 * 60,
      condition: 'no_reply',
      messages: [
        {
          type: 'buttons',
          body: "Hi! Just checking if you're still exploring billing and accounting software for your business.\n\nWe'd be happy to show you how Khatario can simplify your daily billing and business management.\n\nWould you prefer a quick video demo or a personal walkthrough?",
          options: [
            { id: 'cta_demo', title: 'Watch Demo', next: 'demo' },
            { id: 'cta_expert', title: 'Talk to Expert', next: 'handoff' },
          ],
        },
      ],
    },
    {
      kind: 'reengage_48h',
      label: 'Re-engagement template (48 hours, no reply)',
      enabled: true,
      anchor: 'awaiting_reply',
      delayMinutes: 48 * 60,
      condition: 'no_reply',
      templateEventKey: 'funnel_reengage',
      templateVars: ['first_name'],
    },
    {
      kind: 'demo_no_trial',
      label: 'Watched demo, no trial (48 hours)',
      enabled: true,
      anchor: 'demo_sent',
      delayMinutes: 48 * 60,
      condition: 'no_trial',
      messages: [
        {
          type: 'buttons',
          body: 'Hi {{first_name}}! Did you get a chance to watch the Khatario demo?\n\nIf you have any questions, or want us to set it up with you, we are happy to help.',
          options: [
            { id: 'cta_trial', title: 'Start Free Trial', next: 'trial_business_name' },
            { id: 'cta_expert', title: 'Talk to Expert', next: 'handoff' },
          ],
        },
      ],
      templateEventKey: 'funnel_demo_no_trial',
      templateVars: ['first_name'],
    },
    {
      kind: 'first_invoice_2h',
      label: 'Help with first invoice (2 hours after signup)',
      enabled: true,
      anchor: 'trial_created',
      delayMinutes: 120,
      condition: 'no_invoice',
      messages: [
        { type: 'image', mediaKey: 'invoice_new', caption: 'Sales > Invoices > New invoice' },
        {
          type: 'text',
          body: 'Hello {{first_name}}! Welcome to Khatario 👋\n\nHave you created your first invoice yet? It takes under a minute:\n1. Open Sales > Invoices > New invoice\n2. Pick or add a customer\n3. Add items and save\n\nOpen Khatario: {{app_link}}\n\nReply HELP if you need assistance.',
        },
      ],
      templateEventKey: 'funnel_first_invoice',
      templateVars: ['first_name'],
    },
    {
      kind: 'first_invoice_d1',
      label: 'First invoice reminder (day 1)',
      enabled: true,
      anchor: 'trial_created',
      delayMinutes: 24 * 60,
      condition: 'no_invoice',
      messages: [
        {
          type: 'text',
          body: 'Hi {{first_name}}! We can help you set up {{business_name}} and create your first GST invoice together.\n\nReply HELP and an expert will guide you, or open Khatario: {{app_link}}',
        },
      ],
      templateEventKey: 'funnel_first_invoice',
      templateVars: ['first_name'],
    },
    {
      kind: 'trial_inactive_d5',
      label: 'Trial inactive (day 5)',
      enabled: true,
      anchor: 'trial_created',
      delayMinutes: 5 * 24 * 60,
      condition: 'no_invoice',
      messages: [
        {
          type: 'buttons',
          body: 'Hi {{first_name}}! We noticed you have not created an invoice in Khatario yet. Is something holding you back?\n\nTell us and we will help you get started.',
          options: [{ id: 'trial_help', title: 'Talk to Expert', next: 'handoff' }],
        },
      ],
      templateEventKey: 'funnel_trial_inactive',
      templateVars: ['first_name'],
    },
    {
      kind: 'trial_feature_d7',
      label: 'Feature tip for active trials (day 7)',
      enabled: true,
      anchor: 'trial_created',
      delayMinutes: 7 * 24 * 60,
      condition: 'activated_not_paid',
      messages: [
        {
          type: 'text',
          body: 'Great work {{first_name}}! You are already billing with Khatario.\n\nTip: set up payment reminders and stock alerts so Khatario works for you every day. Open Khatario: {{app_link}}',
        },
      ],
      templateEventKey: 'funnel_trial_feature',
      templateVars: ['first_name'],
      headerMediaByPainPoint: {
        inventory: 'invoice_items',
        outstanding: 'sales_list',
        gst_accounting: 'invoice_new',
        billing_speed: 'invoice_save',
      },
    },
  ],
  settings: {
    funnelEnabled: true,
    optOutReply: 'You will not receive further messages from Khatario. Reply START anytime to talk to us again.',
    optInReply: 'Welcome back! How can we help you today?',
    notUnderstood: 'Sorry, I did not catch that. Please tap one of the options below.',
    stopKeywords: ['stop', 'unsubscribe', 'stop all', 'band karo'],
    startKeywords: ['start', 'subscribe'],
    helpKeywords: ['help', 'agent', 'human', 'call me', 'talk to expert'],
    restartKeywords: ['menu', 'restart', 'start over'],
    maxReasks: 2,
  },
};

export function businessTypeLabel(value: string | null | undefined): string {
  return BUSINESS_TYPES.find((b) => b.value === value)?.label ?? '';
}

export function painPointLabel(value: string | null | undefined): string {
  return PAIN_POINTS.find((p) => p.value === value)?.label ?? '';
}

/** Built-in images shipped with the app; uploaded media with the same key takes precedence. */
export const BUILTIN_MEDIA: Record<string, { kind: 'image' | 'video'; path: string; mime: string; label: string }> = {
  sales_list: { kind: 'image', path: 'public/help/how-to/create-invoice-02-all-invoices.png', mime: 'image/png', label: 'Invoices list' },
  invoice_new: { kind: 'image', path: 'public/help/how-to/create-invoice-03-new-invoice.png', mime: 'image/png', label: 'New invoice screen' },
  invoice_customer: { kind: 'image', path: 'public/help/how-to/create-invoice-04-customer.png', mime: 'image/png', label: 'Pick a customer' },
  invoice_items: { kind: 'image', path: 'public/help/how-to/create-invoice-09-pick-item.png', mime: 'image/png', label: 'Add items' },
  invoice_save: { kind: 'image', path: 'public/help/how-to/create-invoice-10-save.png', mime: 'image/png', label: 'Save invoice' },
};
