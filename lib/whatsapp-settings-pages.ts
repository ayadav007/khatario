/**
 * Settings > WhatsApp pages, in the order a business sets them up. The in-page tabs, the
 * Settings menu and the mobile WhatsApp settings sheet all read this list.
 *
 * `connect` pages are always listed; without the Connect plan they show a lock and the page
 * explains what Connect adds, so businesses can see what they would get.
 */
export type WhatsAppSettingsPage = {
  href: string;
  label: string;
  description: string;
  searchKeywords: string[];
  connect: boolean;
};

export const WHATSAPP_SETTINGS_BASE = '/settings/whatsapp';

export const WHATSAPP_SETTINGS_PAGES: WhatsAppSettingsPage[] = [
  {
    href: WHATSAPP_SETTINGS_BASE,
    label: 'Connection',
    description: 'Link your number by QR, or the official WhatsApp API',
    searchKeywords: ['whatsapp', 'qr', 'meta', 'cloud api', 'waba'],
    connect: false,
  },
  {
    href: `${WHATSAPP_SETTINGS_BASE}/notifications`,
    label: 'Reminders',
    description: 'Automatic payment reminders and updates for you',
    searchKeywords: ['whatsapp', 'reminder', 'payment reminder', 'notification', 'owner updates'],
    connect: false,
  },
  {
    href: `${WHATSAPP_SETTINGS_BASE}/inbox`,
    label: 'Team & inbox',
    description: 'Agents, chat assignment and saved replies',
    searchKeywords: ['whatsapp', 'inbox', 'agents', 'team', 'auto assign', 'saved replies', 'quick replies'],
    connect: true,
  },
  {
    href: `${WHATSAPP_SETTINGS_BASE}/ai-agent`,
    label: 'AI agent',
    description: 'Answer customer chats automatically',
    searchKeywords: ['ai', 'ai agent', 'chatbot', 'bot', 'assistant', 'knowledge'],
    connect: true,
  },
  {
    href: `${WHATSAPP_SETTINGS_BASE}/templates`,
    label: 'Templates',
    description: 'Meta-approved message templates',
    searchKeywords: ['whatsapp', 'template', 'meta template', 'reminder', 'invoice'],
    connect: true,
  },
  {
    href: `${WHATSAPP_SETTINGS_BASE}/shop`,
    label: 'Shop',
    description: 'WhatsApp catalog and orders',
    searchKeywords: ['shop', 'catalog', 'whatsapp', 'orders'],
    connect: true,
  },
];

/** Old address of the agents page, now a section of Team & inbox. */
export const WHATSAPP_SETTINGS_LEGACY_TEAM = `${WHATSAPP_SETTINGS_BASE}/team`;
