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
    <nav aria-label="WhatsApp settings" className="-mx-1 overflow-x-auto border-b border-border px-1 dark:border-border-dark">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => {
          const active =
            t.href === WHATSAPP_SETTINGS_BASE ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
          const Icon = t.icon;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                    : 'border-transparent text-text-secondary hover:border-border hover:text-text-primary',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
