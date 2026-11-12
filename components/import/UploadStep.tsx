'use client';

import React, { useId } from 'react';
import { Upload } from 'lucide-react';
import { EXPORT_INSTRUCTIONS } from '@/lib/import/presets';
import type { SectionKey, SourceApp } from '@/lib/import/types';

const SOURCE_APPS: { value: SourceApp; label: string }[] = [
  { value: 'tally', label: 'Tally' },
  { value: 'vyapar', label: 'Vyapar' },
  { value: 'zoho_books', label: 'Zoho Books' },
  { value: 'other', label: 'Other' },
];

const OTHER_INSTRUCTIONS = ['Save your list as Excel or CSV, then upload the file here.'];

interface UploadStepProps {
  section: SectionKey;
  sourceApp: SourceApp;
  uploading: boolean;
  error: string | null;
  onSourceApp(app: SourceApp): void;
  onFile(file: File): void;
}

/** Where the file comes from, how to export it, and the file picker. */
export function UploadStep({ section, sourceApp, uploading, error, onSourceApp, onFile }: UploadStepProps) {
  const sourceId = useId();
  const fileId = useId();
  const steps = sourceApp === 'other' ? OTHER_INSTRUCTIONS : EXPORT_INSTRUCTIONS[sourceApp][section];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label htmlFor={sourceId} className="block text-sm font-medium text-text-primary">
          Coming from
        </label>
        <select
          id={sourceId}
          value={sourceApp}
          onChange={(e) => onSourceApp(e.target.value as SourceApp)}
          className="input w-full md:w-64"
          disabled={uploading}
        >
          {SOURCE_APPS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <ol className="list-decimal space-y-1 pl-5 text-sm text-text-secondary">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      <div className="space-y-2">
        <label
          htmlFor={fileId}
          className="flex min-h-11 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface p-6 text-center text-sm text-text-secondary hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <Upload className="h-5 w-5" aria-hidden />
          <span className="font-medium text-text-primary">{uploading ? 'Reading file…' : 'Choose an Excel or CSV file'}</span>
          <span className="text-xs">.xlsx or .csv, up to 10 MB</span>
        </label>
        <input
          id={fileId}
          type="file"
          accept=".xlsx,.csv"
          className="sr-only"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onFile(file);
          }}
        />
        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
