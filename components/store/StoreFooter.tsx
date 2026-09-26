'use client';

import Link from 'next/link';
import { useStore } from '@/lib/store/store-context';
import { chowkInkOn, sanitizeStoreTheme, storeCanvas } from '@/lib/store/store-theme';

export function StoreFooter() {
  const { store } = useStore();
  if (!store) return null;
  const theme = sanitizeStoreTheme(store.store_theme);
  const paper = storeCanvas(theme);
  const ink = chowkInkOn(paper);
  const links = [
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
    { href: '/privacy', label: 'Privacy' },
    { href: '/refund', label: 'Refunds' },
    { href: '/terms', label: 'Terms' },
  ];
  return (
    <footer className="mt-12 border-t px-4 py-8" style={{ borderColor: `${ink}22`, color: ink }}>
      {store.is_demo ? (
        <p className="mb-3 text-center text-[11px] opacity-70">Theme preview — checkout is disabled.</p>
      ) : null}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-[12px]">
        <p className="opacity-70">{store.name}</p>
        <nav className="flex flex-wrap gap-3">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="opacity-70 hover:opacity-100">
              {l.label}
            </Link>
          ))}
          {theme.instagram_url ? (
            <a href={theme.instagram_url} className="opacity-70 hover:opacity-100" target="_blank" rel="noreferrer">
              Instagram
            </a>
          ) : null}
          {theme.whatsapp_url ? (
            <a href={theme.whatsapp_url} className="opacity-70 hover:opacity-100" target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
