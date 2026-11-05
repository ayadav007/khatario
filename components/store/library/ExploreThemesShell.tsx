'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Store } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';

/** The app's settings frame around the in-app theme store (Settings → Themes → Explore themes), with a way back. */
export function ExploreThemesShell({ title, back, children }: { title: string; back: { href: string; label: string }; children: ReactNode }) {
  return (
    <SettingsPageShell
      title={title}
      icon={Store}
      actions={
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800/60"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {back.label}
        </Link>
      }
    >
      {children}
    </SettingsPageShell>
  );
}
