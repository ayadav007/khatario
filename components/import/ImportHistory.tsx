'use client';

import React from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { RunSummary } from '@/lib/import/run';
import { isResumable } from '@/components/import/wizard-state';

const STATUS: Record<RunSummary['status'], { label: string; variant: 'success' | 'warning' | 'secondary' | 'danger' }> = {
  done: { label: 'Done', variant: 'success' },
  undone: { label: 'Undone', variant: 'secondary' },
  committing: { label: 'Unfinished', variant: 'warning' },
  failed: { label: 'Stopped', variant: 'danger' },
};

/** The confirm shown before an undo; history passes no count (a partial undo does not lower `saved`). */
export function undoConfirmText(count?: number): string {
  const records = count === undefined ? 'records' : `${count} records`;
  return `This removes the ${records} this import created. Records already used in a transaction are kept.`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

interface ImportHistoryProps {
  runs: RunSummary[];
  busyRunId: string | null;
  onUndo(run: RunSummary): void;
  onResume(run: RunSummary): void;
}

/** Earlier imports of this section, with Resume for unfinished ones and Undo import. */
export function ImportHistory({ runs, busyRunId, onUndo, onResume }: ImportHistoryProps) {
  if (runs.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="import-history-heading">
      <h2 id="import-history-heading" className="text-base font-semibold text-text-primary">
        Earlier imports
      </h2>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {runs.map((run) => {
          const resumable = isResumable(run);
          const status = resumable ? STATUS.committing : STATUS[run.status];
          const undoable = run.status !== 'undone' && run.saved > 0;
          return (
            <li key={run.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-text-primary">{run.fileName}</span>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                <p className="text-xs text-text-secondary">
                  {formatWhen(run.createdAt)}
                  {run.createdByName ? ` · ${run.createdByName}` : ''}
                </p>
                <p className="text-xs text-text-secondary">
                  {resumable ? `${run.processed} / ${run.total} rows done · ` : ''}
                  {run.saved} saved · {run.skipped} skipped · {run.failed} failed
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {resumable ? (
                  <Button size="sm" variant="secondary" disabled={busyRunId !== null} onClick={() => onResume(run)}>
                    Resume
                  </Button>
                ) : null}
                {undoable ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    isLoading={busyRunId === run.id}
                    disabled={busyRunId !== null}
                    onClick={() => {
                      if (window.confirm(undoConfirmText())) onUndo(run);
                    }}
                  >
                    Undo import
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
