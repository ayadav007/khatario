'use client';

import React from 'react';
import Link from 'next/link';
import { X, ChevronRight, Settings } from 'lucide-react';
import type { ModuleSettingsMenu } from '@/lib/module-settings';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';

type Props = {
  open: boolean;
  onClose: () => void;
  menu: ModuleSettingsMenu;
};

export function ModuleSettingsSheet({ open, onClose, menu }: Props) {
  const { hasFeature } = useFeatureRegistry();

  const entries = menu.entries.filter(
    (e) => !e.featureKey || hasFeature(e.featureKey as Parameters<typeof hasFeature>[0])
  );

  if (!open) return null;

  const body = <SheetBody menu={menu} entries={entries} onClose={onClose} />;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[10070] bg-black/40 animate-in fade-in duration-200"
        aria-label="Close settings menu"
        onClick={onClose}
      />
      <div className="fixed inset-x-0 bottom-0 z-[10071] flex max-h-[75vh] flex-col rounded-t-2xl border border-border bg-background shadow-[0_-8px_30px_rgba(0,0,0,0.15)] animate-in slide-in-from-bottom duration-300 lg:hidden">
        {body}
      </div>
      <div className="fixed inset-0 z-[10071] hidden items-center justify-center p-4 lg:flex pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background shadow-xl max-h-[80vh] flex flex-col">
          {body}
        </div>
      </div>
    </>
  );
}

function SheetBody({
  menu,
  entries,
  onClose,
}: {
  menu: ModuleSettingsMenu;
  entries: ModuleSettingsMenu['entries'];
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <h2 className="text-base font-semibold text-text-primary">{menu.title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-text-secondary hover:bg-gray-100 dark:hover:bg-slate-800"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li key={entry.href}>
              <Link
                href={entry.href}
                onClick={onClose}
                className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">{entry.label}</p>
                  {entry.description ? (
                    <p className="text-xs text-text-secondary mt-0.5">{entry.description}</p>
                  ) : null}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href="/settings"
          onClick={onClose}
          className="mt-2 flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-medium text-text-secondary hover:bg-gray-50 dark:hover:bg-slate-800/60"
        >
          <Settings className="h-4 w-4" />
          All settings
        </Link>
      </div>
    </>
  );
}

