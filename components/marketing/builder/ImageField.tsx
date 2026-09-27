'use client';

import { useCallback, useRef, useState } from 'react';
import { ImageIcon, Loader2, Trash2, Upload, X } from 'lucide-react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { isSafeImageSrc } from '@/lib/marketing-builder/safe-url';

type MediaItem = { url: string; name: string; bytes: number; created_at: string };

export function ImageFieldInput({
  value,
  onChange,
  readOnly,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<MediaItem[] | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/admin/marketing/media', { ...platformAdminFetchInit, method: 'POST', body: form });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Upload failed');
        onChange(json.url);
        setLibrary(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const openLibrary = useCallback(async () => {
    setLibraryOpen((o) => !o);
    if (library) return;
    try {
      const res = await fetch('/api/admin/marketing/media', platformAdminFetchInit);
      const json = await res.json();
      setLibrary(json.items ?? []);
    } catch {
      setLibrary([]);
    }
  }, [library]);

  const applyUrl = () => {
    const v = urlDraft.trim();
    if (!v) return;
    if (!isSafeImageSrc(v)) {
      setError('Use an https:// image link or upload a file');
      return;
    }
    setError(null);
    onChange(v);
    setUrlDraft('');
  };

  return (
    <div className="space-y-2 text-sm">
      <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-contain" />
        ) : (
          <ImageIcon className="h-8 w-8 text-slate-300" aria-hidden />
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="h-6 w-6 animate-spin text-slate-600" aria-label="Uploading" />
          </div>
        )}
      </div>

      {!readOnly && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Upload
            </button>
            <button
              type="button"
              onClick={openLibrary}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ImageIcon className="h-3.5 w-3.5" aria-hidden />
              Library
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Remove
              </button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
          <div className="flex gap-1.5">
            <input
              type="url"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyUrl();
                }
              }}
              placeholder="…or paste an https:// image link"
              className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={applyUrl}
              className="rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Use
            </button>
          </div>
          {libraryOpen && (
            <div className="rounded-md border border-slate-200 bg-white p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Uploaded images</span>
                <button type="button" onClick={() => setLibraryOpen(false)} aria-label="Close library">
                  <X className="h-3.5 w-3.5 text-slate-500" />
                </button>
              </div>
              {library === null ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-400" />
              ) : library.length === 0 ? (
                <p className="text-xs text-slate-500">No uploads yet.</p>
              ) : (
                <div className="grid max-h-48 grid-cols-3 gap-1.5 overflow-y-auto">
                  {library.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => {
                        onChange(item.url);
                        setLibraryOpen(false);
                      }}
                      className={`aspect-square overflow-hidden rounded border ${
                        item.url === value ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-200'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {error && <p className="text-xs font-medium text-rose-700">{error}</p>}
    </div>
  );
}
