'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { OP_ERROR_TEXT, addPage, canAddPage, slugifyHandle } from '@/lib/store/engine/editor/ops';
import { PAGE_STARTERS } from '@/lib/store/engine/presets/templates';
import { PAGE_META_CAPS } from '@/lib/store/engine/shared';
import { useStudio2 } from './Studio2Editor';
import { inputCls } from './fields/pickers';

type Starter = keyof typeof PAGE_STARTERS;
const STARTERS = Object.keys(PAGE_STARTERS) as Starter[];

/** D22: a new custom page from a title, an address (slugified from the title until edited) and a starter. */
export function NewPageModal({ onClose }: { onClose(): void }) {
  const { theme, apply, switchTemplate, readOnly } = useStudio2();
  const dialogRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('');
  const [handleEdited, setHandleEdited] = useState(false);
  const [starter, setStarter] = useState<Starter>('blank');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector<HTMLElement>('input')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);

  // An empty address is not an error yet; a full theme is, whatever the address.
  const check = canAddPage(theme, handle);
  const handleErr = handle || check === 'page_limit' ? check : null;
  const canCreate = !readOnly && title.trim() !== '' && handle !== '' && !handleErr;

  const create = () => {
    if (!canCreate) return;
    let key: string | null = null;
    const err = apply(
      (t) => {
        const r = addPage(t, { handle, title, starter });
        if (r.ok && r.id) key = r.id;
        return r;
      },
      { mergeKey: null, immediate: true },
    );
    if (err) {
      setError(OP_ERROR_TEXT[err]);
      return;
    }
    onClose();
    if (key) switchTemplate(key);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio2-new-page-title"
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 id="studio2-new-page-title" className="text-base font-semibold text-gray-900">
            New page
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="space-y-1.5">
            <label htmlFor="s2-new-page-title" className="text-xs font-medium text-gray-700">
              Title
            </label>
            <input
              id="s2-new-page-title"
              className={inputCls}
              value={title}
              maxLength={PAGE_META_CAPS.title}
              placeholder="Diwali Sale"
              onChange={(e) => {
                setTitle(e.target.value);
                if (!handleEdited) setHandle(slugifyHandle(e.target.value));
                setError(null);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="s2-new-page-handle" className="text-xs font-medium text-gray-700">
              Address
            </label>
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <span className="shrink-0">/pages/</span>
              <input
                id="s2-new-page-handle"
                className={clsx(inputCls, 'font-mono', handleErr && 'border-red-400')}
                value={handle}
                maxLength={50}
                aria-invalid={!!handleErr}
                aria-describedby="s2-new-page-handle-help"
                onChange={(e) => {
                  setHandle(e.target.value);
                  setHandleEdited(true);
                  setError(null);
                }}
              />
            </div>
            <p id="s2-new-page-handle-help" className={clsx('text-[11px]', handleErr ? 'text-red-600' : 'text-gray-500')}>
              {handleErr ? OP_ERROR_TEXT[handleErr] : "The address can't be changed after the page is created."}
            </p>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-xs font-medium text-gray-700">Start from</legend>
            <div className="grid grid-cols-2 gap-2">
              {STARTERS.map((key) => (
                <label
                  key={key}
                  className={clsx(
                    'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                    starter === key ? 'border-blue-500 bg-blue-50 text-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-300',
                  )}
                >
                  <input
                    type="radio"
                    name="s2-new-page-starter"
                    value={key}
                    checked={starter === key}
                    onChange={() => setStarter(key)}
                  />
                  {PAGE_STARTERS[key].label}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canCreate}
            className="h-8 rounded-md bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create page
          </button>
        </div>
      </form>
    </div>
  );
}
