'use client';

import React from 'react';
import { CheckCircle2, Circle, Rocket, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { GoLiveCheck } from '@/lib/ai-agent/types';

const FIX_SECTION: Record<string, string> = {
  summary: 'profile',
  knowledge: 'knowledge',
  fallback: 'handoff',
  provider: 'advanced',
};

export function GoLiveDialog({
  open,
  checklist,
  dirty,
  busy,
  onConfirm,
  onClose,
  onFix,
}: {
  open: boolean;
  checklist: GoLiveCheck[];
  dirty: boolean;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
  onFix: (sectionId: string) => void;
}) {
  if (!open) return null;
  const ready = checklist.every((c) => c.ok) && !dirty;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="go-live-title">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded p-1 text-text-muted hover:bg-gray-100" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-green-700">
            <Rocket className="h-5 w-5" />
          </div>
          <div>
            <h2 id="go-live-title" className="text-lg font-semibold text-text-primary">Go live?</h2>
            <p className="text-sm text-text-secondary">Every customer who messages you will get AI replies.</p>
          </div>
        </div>

        <ul className="space-y-2">
          {checklist.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              {c.ok ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <Circle className="h-5 w-5 text-text-muted" />}
              <span className={c.ok ? 'text-text-primary' : 'text-text-secondary'}>{c.label}</span>
              {!c.ok && FIX_SECTION[c.id] && (
                <button type="button" onClick={() => onFix(FIX_SECTION[c.id])} className="ml-auto text-xs font-medium text-primary-700 hover:underline">
                  Fix
                </button>
              )}
            </li>
          ))}
          {dirty && (
            <li className="flex items-center gap-2 text-sm">
              <Circle className="h-5 w-5 text-text-muted" />
              <span className="text-text-secondary">Save your changes first</span>
            </li>
          )}
        </ul>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Not yet</Button>
          <Button onClick={onConfirm} disabled={!ready} isLoading={busy}>Go live</Button>
        </div>
      </div>
    </div>
  );
}
