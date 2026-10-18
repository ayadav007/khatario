'use client';

import { useEffect, useState } from 'react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import type { BlogMedia } from '@/lib/blog/repo';

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export function BlogMediaDialog({
  open,
  title,
  onClose,
  onPick,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onPick: (media: BlogMedia) => void;
}) {
  const [items, setItems] = useState<BlogMedia[]>([]);
  const [alt, setAlt] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    void fetch('/api/admin/blog/media', platformAdminFetchInit)
      .then((response) => readJson(response))
      .then((data) => setItems(data.items || []))
      .catch((err: Error) => setError(err.message));
    void fetch('/api/admin/blog/media/suggest', platformAdminFetchInit)
      .then((response) => response.json())
      .then((data) => setConfigured(!!data.configured))
      .catch(() => setConfigured(false));
  }, [open]);

  if (!open) return null;

  async function upload(file: File) {
    if (!alt.trim()) {
      setError('Add alt text before uploading.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('alt', alt.trim());
      const data = await readJson(await fetch('/api/admin/blog/media', { ...platformAdminFetchInit, method: 'POST', body }));
      setItems((current) => [data.media, ...current.filter((item: BlogMedia) => item.id !== data.media.id)]);
      onPick(data.media);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function suggest() {
    setBusy(true);
    setError('');
    try {
      const data = await readJson(await fetch('/api/admin/blog/media/suggest', {
        ...platformAdminFetchInit,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, alt: alt.trim() || prompt }),
      }));
      setItems((current) => [data.media, ...current]);
      onPick(data.media);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image suggestion failed. You can still upload one.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="blog-media-title">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="blog-media-title" className="text-lg font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Close</button>
        </div>
        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <label className="mt-4 block text-sm font-medium text-gray-700">
          Alt text
          <input value={alt} onChange={(event) => setAlt(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-gray-300 px-3 text-base" placeholder="What the image shows" />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex h-11 cursor-pointer items-center rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white">
            {busy ? 'Working…' : 'Upload'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
          </label>
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-800">Suggest AI image</p>
          <p className="mt-1 text-xs text-gray-500">
            {configured ? 'Optional. A failed suggestion does not block publishing.' : 'Not configured. Upload an image or pick one below. Publishing still works.'}
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input value={prompt} onChange={(event) => setPrompt(event.target.value)} className="h-11 w-full rounded-lg border border-gray-300 px-3 text-base" placeholder="A shop counter with a GST invoice" />
            <button type="button" disabled={busy || !prompt.trim()} onClick={() => void suggest()} className="h-11 shrink-0 rounded-lg border border-gray-300 px-4 text-sm font-semibold disabled:opacity-50">
              Suggest
            </button>
          </div>
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onPick(item)} className="w-full overflow-hidden rounded-xl border border-gray-200 text-left hover:border-primary-600">
                <img src={item.url} alt={item.alt_text} className="aspect-video w-full object-cover" />
                <span className="block truncate px-2 py-1 text-xs text-gray-600">{item.alt_text}</span>
              </button>
            </li>
          ))}
        </ul>
        {items.length === 0 ? <p className="mt-4 text-sm text-gray-500">No images yet.</p> : null}
      </div>
    </div>
  );
}
