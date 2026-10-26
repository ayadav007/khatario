/**
 * Shared Connect nav items — keep desktop Sidebar and mobile More in sync.
 * Everything here needs the Connect plan (`whatsapp_bot`); Payment Reminders is a Billing
 * feature and lives in Sales instead.
 */

export type ConnectNavItemDef = {
  href: string;
  label: string;
  module: string;
};

export type ConnectNavGroupDef = {
  label: string;
  items: ConnectNavItemDef[];
};

export const CONNECT_NAV_FEATURE_KEY = 'whatsapp_bot';

export const CONNECT_DASHBOARD_ITEM: ConnectNavItemDef = {
  href: '/whatsapp/dashboard',
  label: 'Dashboard',
  module: 'whatsapp',
};

/** Grouped by job: answer customers, reach out to them, manage who you can message. */
export const CONNECT_NAV_GROUPS: ConnectNavGroupDef[] = [
  {
    label: 'Chats',
    items: [
      { href: '/whatsapp/conversations', label: 'Conversations', module: 'whatsapp_inbox' },
      { href: '/whatsapp/pipeline', label: 'Pipeline', module: 'whatsapp_inbox' },
      { href: '/whatsapp/orders', label: 'Order Verification', module: 'whatsapp_inbox' },
      { href: '/whatsapp/flows', label: 'Flows', module: 'whatsapp' },
    ],
  },
  {
    label: 'Send',
    items: [
      { href: '/whatsapp/campaigns', label: 'Campaigns', module: 'whatsapp' },
      { href: '/whatsapp/who-to-message', label: 'Who to message', module: 'whatsapp' },
      { href: '/whatsapp/send-message', label: 'Send Message', module: 'whatsapp' },
    ],
  },
  {
    label: 'Audience',
    items: [
      { href: '/whatsapp/contacts', label: 'Contacts', module: 'whatsapp_inbox' },
      { href: '/whatsapp/contacts/groups', label: 'Contact Groups', module: 'whatsapp' },
      { href: '/whatsapp/unsubscribes', label: 'Unsubscribes', module: 'whatsapp' },
      { href: '/whatsapp/group-extractor', label: 'Group Extractor', module: 'whatsapp' },
    ],
  },
];

export const CONNECT_SETTINGS_ITEM: ConnectNavItemDef = {
  href: '/settings/whatsapp',
  label: 'WhatsApp Settings',
  module: 'whatsapp',
};
