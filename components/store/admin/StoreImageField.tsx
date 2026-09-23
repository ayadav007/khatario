'use client';

import { useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';

export function StoreImageField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'promo');
      formData.append('folder', 'store');
      const res = await fetch('/api/upload/image', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onChange(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <p className="text-xs font-medium text-gray-600">{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p> : null}
      <div className="mt-2 flex items-start gap-3">
        <label className="relative flex h-20 w-20 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          ) : (
            <ImagePlus className="h-5 w-5 text-gray-400" />
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        <div className="min-w-0 flex-1">
          <input
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-900"
            value={value.startsWith('data:') ? '' : value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Or paste https://…"
          />
          {value ? (
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-500"
              onClick={() => onChange('')}
            >
              <X className="h-3 w-3" />
              Remove
            </button>
          ) : (
            <p className="mt-1 text-[11px] text-gray-400">JPEG, PNG, WebP · max 2 MB</p>
          )}
          {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
