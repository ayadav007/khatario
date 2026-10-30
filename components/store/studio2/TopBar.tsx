'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Link2, Loader2, Monitor, Redo2, Smartphone, Undo2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { Device } from './PreviewPane';

interface Props {
  themeName: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  device: Device;
  onDevice(d: Device): void;
  statusLabel: string;
  statusIsError: boolean;
  onCopyPreview(): Promise<void>;
  onPublish(): Promise<void>;
}

const iconBtn =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

export function TopBar(props: Props) {
  const { themeName, canUndo, canRedo, onUndo, onRedo, device, onDevice, statusLabel, statusIsError } = props;
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [copying, setCopying] = useState(false);

  const publish = async () => {
    setPublishing(true);
    try {
      await props.onPublish();
    } finally {
      setPublishing(false);
      setConfirming(false);
    }
  };

  const copy = async () => {
    setCopying(true);
    try {
      await props.onCopyPreview();
    } finally {
      setCopying(false);
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-3">
      <Link
        href="/settings/online-store"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>
      <span className="max-w-[16rem] truncate text-sm font-semibold text-gray-900" title={themeName}>
        {themeName}
      </span>

      <select
        aria-label="Page"
        className="ml-2 h-8 rounded-md border border-gray-300 bg-white px-2 text-sm"
        value="home"
        onChange={() => undefined}
      >
        <option value="home">Home</option>
      </select>

      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={iconBtn} onClick={onUndo} disabled={!canUndo} title="Undo" aria-label="Undo">
          <Undo2 className="h-4 w-4" />
        </button>
        <button type="button" className={iconBtn} onClick={onRedo} disabled={!canRedo} title="Redo" aria-label="Redo">
          <Redo2 className="h-4 w-4" />
        </button>

        <div className="mx-2 flex rounded-md border border-gray-300 p-0.5" role="group" aria-label="Device">
          {(['desktop', 'phone'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              title={d === 'desktop' ? 'Desktop' : 'Phone'}
              aria-label={d === 'desktop' ? 'Desktop' : 'Phone'}
              onClick={() => onDevice(d)}
              className={clsx(
                'inline-flex h-7 w-7 items-center justify-center rounded',
                device === d ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              {d === 'desktop' ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
            </button>
          ))}
        </div>

        <span
          className={clsx(
            'mr-2 max-w-[14rem] truncate text-xs',
            statusIsError ? 'text-red-600' : 'text-gray-500',
          )}
          aria-live="polite"
          title={statusLabel}
        >
          {statusLabel}
        </span>

        <button
          type="button"
          onClick={() => void copy()}
          disabled={copying}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          Preview
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex h-8 items-center rounded-md bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800"
        >
          Publish
        </button>
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/30"
          role="dialog"
          aria-modal="true"
          aria-labelledby="studio2-publish-title"
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <p id="studio2-publish-title" className="text-sm text-gray-900">
              Publish this theme? Shoppers will see it now.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={publishing}
                className="h-8 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void publish()}
                disabled={publishing}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
                Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
