'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { Bell, Bot, FileText, Inbox, ShoppingBag, Smartphone, Users, type LucideIcon } from 'lucide-react';

export const WHATSAPP_SETTINGS_BASE = '/settings/whatsapp';

type NavTab = { href: string; label: string; icon: LucideIcon; connectOnly?: boolean };

export const WHATSAPP_SETTINGS_TABS: NavTab[] = [
  { href: WHATSAPP_SETTINGS_BASE, label: 'Connection', icon: Smartphone },
  { href: `${WHATSAPP_SETTINGS_BASE}/templates`, label: 'Templates', icon: FileText },
  { href: `${WHATSAPP_SETTINGS_BASE}/notifications`, label: 'Notifications', icon: Bell },
  { href: `${WHATSAPP_SETTINGS_BASE}/inbox`, label: 'Inbox & team', icon: Inbox, connectOnly: true },
  { href: `${WHATSAPP_SETTINGS_BASE}/team`, label: 'Agents', icon: Users, connectOnly: true },
  { href: `${WHATSAPP_SETTINGS_BASE}/ai-agent`, label: 'AI agent', icon: Bot },
  { href: `${WHATSAPP_SETTINGS_BASE}/shop`, label: 'Shop', icon: ShoppingBag },
];

export function WhatsAppSettingsNav({ hasConnect }: { hasConnect: boolean }) {
  const pathname = usePathname() ?? '';
  const tabs = WHATSAPP_SETTINGS_TABS.filter((t) => !t.connectOnly || hasConnect);

  return (
    <nav
      aria-label="WhatsApp settings"
      className="shrink-0 border-b border-border dark:border-border-dark lg:w-52 lg:border-b-0 lg:border-r lg:pr-4"
    >
      <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
        {tabs.map((t) => {
          const active =
            t.href === WHATSAPP_SETTINGS_BASE ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          const Icon = t.icon;
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
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
