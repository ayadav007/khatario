'use client';

import { useState } from 'react';
import { Film, ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import type { MediaInfo } from './MessagesEditor';
import { Badge, btnCls, dangerBtnCls, Field, inputCls, Notice, primaryBtnCls, sendJson, State, useJson } from './shared';

type MediaFull = MediaInfo & { mimeType: string; sizeBytes: number };

const UPLOAD_LIMIT_MB = 12;

function UploadForm({ initialKey, initialKind, onDone }: { initialKey?: string; initialKind?: 'image' | 'video'; onDone: (msg: string) => void }) {
  const [key, setKey] = useState(initialKey || '');
  const [kind, setKind] = useState<'image' | 'video'>(initialKind || 'image');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!file) return;
    if (file.size > UPLOAD_LIMIT_MB * 1024 * 1024) {
      setError(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Keep uploads under ${UPLOAD_LIMIT_MB} MB (compress the video to 720p).`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('key', key);
      form.append('kind', kind);
      if (label) form.append('label', label);
      const res = await fetch('/api/admin/sales-flow/media', { ...platformAdminFetchInit, method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      setFile(null);
      onDone(`Uploaded "${key}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Key" hint="Used in the flow, e.g. demo_video">
          <input className={inputCls} value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
        </Field>
        <Field label="Type">
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as 'image' | 'video')}>
            <option value="image">Image (JPG/PNG, up to 5 MB)</option>
            <option value="video">Video (MP4, up to {UPLOAD_LIMIT_MB} MB)</option>
          </select>
        </Field>
        <Field label="Label (optional)">
          <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="File">
          <input
            type="file"
            accept={kind === 'video' ? 'video/mp4' : 'image/jpeg,image/png'}
            className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-primary-700"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </Field>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button type="button" className={primaryBtnCls} disabled={busy || !file || !key} onClick={submit}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload
      </button>
    </div>
  );
}

export function MediaTab({ canEdit }: { canEdit: boolean }) {
  const { data, error, loading, reload } = useJson<{ media: MediaFull[] }>('/api/admin/sales-flow/media');
  const [msg, setMsg] = useState('');
  const [replacing, setReplacing] = useState<string | null>(null);
  if (!data) return <State loading={loading} error={error} />;
  const hasVideo = data.media.some((m) => m.key === 'demo_video' && m.uploaded);

  const remove = async (key: string) => {
    if (!window.confirm(`Remove "${key}"? Built-in screenshots come back as the default.`)) return;
    try {
      await sendJson(`/api/admin/sales-flow/media/${key}`, 'DELETE');
      setMsg(`Removed "${key}".`);
      await reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="space-y-5">
      {!hasVideo ? (
        <Notice tone="warn">
          <p className="font-medium">The 90-second demo video is not uploaded yet.</p>
          <p>Until it is, the Demo step sends the three invoice screenshots instead. Upload an MP4 with the key <code>demo_video</code> (720p, under {UPLOAD_LIMIT_MB} MB).</p>
        </Notice>
      ) : null}
      {msg ? <Notice tone="info">{msg}</Notice> : null}

      {canEdit ? (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-gray-900">Upload image or video</h3>
          <UploadForm
            initialKey={hasVideo ? '' : 'demo_video'}
            initialKind={hasVideo ? 'image' : 'video'}
            onDone={(m) => {
              setMsg(m);
              void reload();
            }}
          />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.media.map((m) => (
          <div key={m.key} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex h-48 items-center justify-center bg-gray-100">
              {m.kind === 'video' ? (
                m.uploaded ? (
                  <video src={m.previewUrl} controls preload="metadata" className="h-full w-full object-contain" />
                ) : (
                  <Film className="h-10 w-10 text-gray-300" />
                )
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.previewUrl} alt={m.label} className="h-full w-full object-contain" />
              )}
            </div>
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-gray-900">{m.label}</span>
                {m.kind === 'video' ? <Film className="h-4 w-4 text-gray-400" /> : <ImageIcon className="h-4 w-4 text-gray-400" />}
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge>{m.key}</Badge>
                {m.uploaded ? <Badge tone="green">uploaded</Badge> : m.builtin ? <Badge tone="blue">built-in screenshot</Badge> : <Badge tone="amber">missing</Badge>}
                {m.sizeBytes ? <Badge>{(m.sizeBytes / 1024 / 1024).toFixed(1)} MB</Badge> : null}
              </div>
              {canEdit ? (
                <div className="flex gap-2">
                  <button type="button" className={btnCls} onClick={() => setReplacing(replacing === m.key ? null : m.key)}>
                    <Upload className="h-4 w-4" /> {m.uploaded ? 'Replace' : 'Upload'}
                  </button>
                  {m.uploaded ? (
                    <button type="button" className={dangerBtnCls} onClick={() => remove(m.key)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              ) : null}
              {replacing === m.key ? (
                <UploadForm
                  initialKey={m.key}
                  initialKind={m.kind}
                  onDone={(msg2) => {
                    setReplacing(null);
                    setMsg(msg2);
                    void reload();
                  }}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
