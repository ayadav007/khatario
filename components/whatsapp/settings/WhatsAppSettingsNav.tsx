'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { Bell, Bot, FileText, Inbox, Lock, ShoppingBag, Smartphone, type LucideIcon } from 'lucide-react';
import { WHATSAPP_SETTINGS_BASE, WHATSAPP_SETTINGS_PAGES, type WhatsAppSettingsPage } from '@/lib/whatsapp-settings-pages';
import { useWhatsAppAccess } from './useWhatsAppAccess';

export { WHATSAPP_SETTINGS_BASE };

const ICONS: Record<string, LucideIcon> = {
  [WHATSAPP_SETTINGS_BASE]: Smartphone,
  [`${WHATSAPP_SETTINGS_BASE}/notifications`]: Bell,
  [`${WHATSAPP_SETTINGS_BASE}/inbox`]: Inbox,
  [`${WHATSAPP_SETTINGS_BASE}/ai-agent`]: Bot,
  [`${WHATSAPP_SETTINGS_BASE}/templates`]: FileText,
  [`${WHATSAPP_SETTINGS_BASE}/shop`]: ShoppingBag,
};

const BASIC_PAGES = WHATSAPP_SETTINGS_PAGES.filter((p) => !p.connect);
const CONNECT_PAGES = WHATSAPP_SETTINGS_PAGES.filter((p) => p.connect);

export function WhatsAppSettingsNav() {
  const pathname = usePathname() ?? '';
  const { hasConnect, loading } = useWhatsAppAccess();

  const tab = (t: WhatsAppSettingsPage) => {
    const active =
      t.href === WHATSAPP_SETTINGS_BASE ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
    const Icon = ICONS[t.href] ?? Smartphone;
    const locked = t.connect && !loading && !hasConnect;
    return (
      <li key={t.href} className="shrink-0 lg:w-full">
        <Link
          href={t.href}
          aria-current={active ? 'page' : undefined}
          className={clsx(
            'inline-flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            active
              ? 'bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200'
              : 'text-text-secondary hover:bg-slate-50 hover:text-text-primary dark:hover:bg-slate-800',
          )}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">{t.label}</span>
          {locked ? <Lock className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-label="Needs Connect" /> : null}
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label="WhatsApp settings"
      className="shrink-0 border-b border-border dark:border-border-dark lg:w-52 lg:border-b-0 lg:border-r lg:pr-4"
    >
      <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
        {BASIC_PAGES.map(tab)}
        <li
          aria-hidden
          className="hidden px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-muted lg:block"
        >
          Connect
        </li>
        {CONNECT_PAGES.map(tab)}
      </ul>
    </nav>
  );
}
