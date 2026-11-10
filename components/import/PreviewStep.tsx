'use client';

import React from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { UNIT_CODES } from '@/lib/import/parse-values';
import { GST_STATE_NAMES } from '@/lib/tax/gstin';
import { resolveState } from '@/lib/tax/state-names';
import type { PreviewResult } from '@/lib/import/run';
import type { ImportField } from '@/lib/import/types';

const STATE_CHOICES = Array.from(
  new Set(
    Object.keys(GST_STATE_NAMES)
      .map((code) => resolveState(code)?.state)
      .filter((s): s is string => Boolean(s))
  )
);
const TAX_RATE_CHOICES = ['0', '0.25', '3', '5', '12', '18', '28'];

/** What the user picks from for a value the file uses that the app does not recognise. */
function choicesFor(type: ImportField['type'] | undefined): { value: string; label: string }[] {
  if (type === 'state') return STATE_CHOICES.map((s) => ({ value: s, label: s }));
  if (type === 'unit') return UNIT_CODES.map((u) => ({ value: u, label: u }));
  if (type === 'tax_rate') return TAX_RATE_CHOICES.map((r) => ({ value: r, label: `${r}%` }));
  return [];
}

const PROBLEM_LABEL: Record<PreviewResult['problems'][number]['status'], string> = {
  needs_attention: 'Needs attention',
  already_exists: 'Already exists',
};

interface PreviewStepProps {
  sectionLabel: string;
  fields: ImportField[];
  preview: PreviewResult | null;
  loading: boolean;
  error: string | null;
  valueMatches: Record<string, Record<string, string>>;
  /** Every row the preview will not import, as a CSV download. */
  problemRowsHref: string | null;
  onValueMatch(field: string, value: string, choice: string): void;
  onBack(): void;
  onImport(): void;
}

/** Counts, values to match, rows that will not be imported, and the Import button. */
export function PreviewStep({
  sectionLabel,
  fields,
  preview,
  loading,
  error,
  valueMatches,
  problemRowsHref,
  onValueMatch,
  onBack,
  onImport,
}: PreviewStepProps) {
  if (!preview) {
    return (
      <div className="space-y-4">
        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Checking your file…
          </div>
        )}
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    );
  }

  const typeOf = new Map(fields.map((f) => [f.key, f.type]));
  const notImported = preview.needsAttention + preview.alreadyExists;
  const unresolved = preview.unmatched.length > 0;
  const canImport = preview.ready > 0 && preview.limit.allowed && !unresolved && !loading;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        {[
          { label: 'Ready', value: preview.ready },
          { label: 'Needs attention', value: preview.needsAttention },
          { label: 'Already exists', value: preview.alreadyExists },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-border p-3">
            <p className="text-xs text-text-secondary">{c.label}</p>
            <p className="text-xl font-semibold text-text-primary">{c.value}</p>
          </div>
        ))}
      </div>
      {preview.warnings > 0 ? (
        <p className="text-sm text-text-secondary">
          {preview.warnings} ready {preview.warnings === 1 ? 'row has' : 'rows have'} warnings: those values are left out.
        </p>
      ) : null}

      {unresolved ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-text-primary">Choose what these values mean</h2>
          {preview.unmatched.map((u) => {
            const choices = choicesFor(typeOf.get(u.field));
            return (
              <div key={u.field} className="space-y-2">
                <h3 className="text-sm font-medium text-text-primary">{u.label}</h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {u.values.map((value) => {
                    const id = `import-value-${u.field}-${value}`;
                    return (
                      <li key={value} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
                        <label htmlFor={id} className="min-w-0 break-words text-sm text-text-primary">
                          {value}
                        </label>
                        <select
                          id={id}
                          className="input w-full md:w-64"
                          value={valueMatches[u.field]?.[value] ?? ''}
                          disabled={loading}
                          onChange={(e) => onValueMatch(u.field, value, e.target.value)}
                        >
                          <option value="">Choose…</option>
                          {choices.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>
      ) : null}

      {preview.problems.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-text-primary">Rows that will not be imported</h2>
          {notImported > preview.problems.length ? (
            <p className="text-xs text-text-secondary">Showing the first {preview.problems.length} of {notImported}.</p>
          ) : null}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {preview.problems.map((p) => (
              <li key={p.rowNumber} className="space-y-1 p-3 text-sm">
                <p className="font-medium text-text-primary">
                  Row {p.rowNumber} · {PROBLEM_LABEL[p.status]}
                </p>
                <p className="text-text-secondary">{p.reasons.join('; ')}</p>
              </li>
            ))}
          </ul>
          {problemRowsHref ? (
            <a href={problemRowsHref} download>
              <Button variant="secondary">Download problem rows</Button>
            </a>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {!preview.limit.allowed ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {preview.limit.message ?? 'Your plan limit is reached.'}{' '}
          <Link href="/settings/subscription" className="font-medium underline">
            See plans
          </Link>
        </p>
      ) : null}
      {unresolved ? (
        <p className="text-sm text-text-secondary">Choose a value for every entry above first.</p>
      ) : null}

      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={onBack} disabled={loading}>
          Back
        </Button>
        <Button onClick={onImport} disabled={!canImport} isLoading={loading}>
          Import {preview.ready} {sectionLabel}
        </Button>
      </div>
    </div>
  );
}
