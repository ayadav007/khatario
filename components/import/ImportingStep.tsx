'use client';

import React from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { undoConfirmText } from '@/components/import/ImportHistory';
import type { Paused, Progress, UndoResult } from '@/components/import/wizard-state';

interface ImportingStepProps {
  done: boolean;
  progress: Progress | null;
  paused: Paused | null;
  undone: UndoResult | null;
  undoing: boolean;
  problemRowsHref: string | null;
  listHref: string;
  listLabel: string;
  onResume(): void;
  onUndo(): void;
}

/** Progress while batches run, then the saved, skipped and failed counts. */
export function ImportingStep({
  done,
  progress,
  paused,
  undone,
  undoing,
  problemRowsHref,
  listHref,
  listLabel,
  onResume,
  onUndo,
}: ImportingStepProps) {
  const p = progress ?? { processed: 0, total: 0, saved: 0, skipped: 0, failed: 0 };

  if (!done) {
    const pct = p.total > 0 ? Math.min(100, Math.round((p.processed / p.total) * 100)) : 0;
    return (
      <div className="space-y-4">
        {paused ? (
          <div className="space-y-3">
            <p className="font-medium text-text-primary">
              Import paused after {paused.processed} of {paused.total} rows.
            </p>
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {paused.message}
            </p>
            <Button onClick={onResume}>Resume</Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Importing… You can leave this page; the import can be resumed from here later.
          </div>
        )}
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={p.total}
          aria-valuenow={p.processed}
        >
          <div className="h-full bg-primary-600" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-text-secondary">
          {p.processed} / {p.total}
        </p>
      </div>
    );
  }

  const hasProblems = p.skipped + p.failed > 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        {[
          { label: 'Saved', value: p.saved },
          { label: 'Skipped', value: p.skipped },
          { label: 'Failed', value: p.failed },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-border p-3">
            <p className="text-xs text-text-secondary">{c.label}</p>
            <p className="text-xl font-semibold text-text-primary">{c.value}</p>
          </div>
        ))}
      </div>

      {undone ? (
        <div className="space-y-2 text-sm">
          <p className="text-text-primary">Removed {undone.removed} records.</p>
          {undone.kept.length > 0 ? (
            <>
              <p className="text-text-secondary">Kept because they are already used:</p>
              <ul className="list-disc space-y-1 pl-5 text-text-secondary">
                {undone.kept.map((k, i) => (
                  <li key={`${k.label}-${i}`}>
                    {k.label}: {k.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {hasProblems && problemRowsHref ? (
          <a href={problemRowsHref} download>
            <Button variant="secondary">Download problem rows</Button>
          </a>
        ) : null}
        {p.saved > 0 && (!undone || undone.kept.length > 0) ? (
          <Button
            variant="secondary"
            isLoading={undoing}
            onClick={() => {
              if (window.confirm(undoConfirmText(undone ? undone.kept.length : p.saved))) onUndo();
            }}
          >
            Undo import
          </Button>
        ) : null}
        <Link href={listHref}>
          <Button>Back to {listLabel}</Button>
        </Link>
      </div>
    </div>
  );
}
