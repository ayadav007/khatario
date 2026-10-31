'use client';

import { useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { isVideoUrl } from '@/lib/store/theme-media-url';

export function StoreImageField({
  label,
  hint,
  value,
  onChange,
  uploadUrl,
  allowVideo = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (url: string) => void;
  /** Upload route that stores the file and returns its URL (Studio 2); the default returns a data URL. */
  uploadUrl?: string;
  /** Studio 2 fields that play video: MP4 and WebM are also taken. */
  allowVideo?: boolean;
}) {
  const isVideo = isVideoUrl(value);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    // Matches the server's caps, so a big file fails before a long upload.
    const motion = file.type === 'image/gif' || file.type.startsWith('video/');
    const maxMb = uploadUrl ? (motion ? 10 : 5) : 2;
    if (file.size > maxMb * 1024 * 1024) {
      setError(`${motion ? 'GIFs and videos' : 'Photos'} must be ${maxMb} MB or smaller.`);
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'promo');
      formData.append('folder', 'store');
      if (allowVideo) formData.append('video', '1');
      const res = await fetch(uploadUrl ?? '/api/upload/image', { method: 'POST', body: formData });
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
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          ) : value && isVideo ? (
            <video src={value} muted loop autoPlay playsInline className="h-full w-full object-cover" />
          ) : value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-5 w-5 text-gray-400" />
          )}
          <input
            type="file"
            accept={
              uploadUrl
                ? `image/jpeg,image/png,image/webp,image/avif,image/gif${allowVideo ? ',video/mp4,video/webm' : ''}`
                : 'image/jpeg,image/png,image/webp,image/gif'
            }
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
            <p className="mt-1 text-[11px] text-gray-400">
              {uploadUrl
                ? `JPEG, PNG, WebP · max 5 MB. GIF${allowVideo ? ', MP4' : ''} · max 10 MB`
                : 'JPEG, PNG, WebP · max 2 MB'}
            </p>
          )}
          {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
