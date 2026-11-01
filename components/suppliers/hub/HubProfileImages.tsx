'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';
import { SupplierAvatar, supplierTint } from '@/components/suppliers/hub/DirectoryUi';

/**
 * Logo and cover photo for the seller's Supplier Hub profile.
 * The logo is the business logo (also printed on invoices); the cover belongs to the directory listing.
 * Both are scaled down in the browser first, since uploads are stored as data URLs.
 */

const LOGO_MAX_PX = 512;
const COVER_MAX_PX = 1600;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image we can read. Use PNG, JPEG or WebP.'));
    };
    img.src = url;
  });
}

/** Fits the image inside maxPx; keeps PNG/WebP transparency for logos, JPEG for photos. */
async function shrink(file: File, maxPx: number, keepAlpha: boolean): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image');
  const alpha = keepAlpha && file.type !== 'image/jpeg';
  if (!alpha) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = alpha ? 'image/png' : 'image/jpeg';
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image'))), type, 0.85)
  );
}

async function upload(blob: Blob, kind: 'logo' | 'cover'): Promise<string> {
  const fd = new FormData();
  fd.append('file', new File([blob], `${kind}.${blob.type === 'image/png' ? 'png' : 'jpg'}`, { type: blob.type }));
  fd.append('type', kind === 'logo' ? 'logo' : 'promo');
  const res = await fetch('/api/upload/image', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.url as string;
}

async function patch(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save');
  return data;
}

export function HubProfileImages({
  coverUrl,
  onCoverChange,
}: {
  coverUrl: string | null;
  onCoverChange: (url: string | null) => void;
}) {
  const { business, refresh } = useAuth();
  const toast = useToastContext();
  const [busy, setBusy] = useState<'logo' | 'cover' | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  if (!business?.id) return null;
  const logoUrl = (business as { logo_url?: string | null }).logo_url || null;

  async function saveLogo(url: string | null) {
    await patch(`/api/business/${business!.id}`, { business_id: business!.id, logo_url: url ?? '' });
    await refresh();
  }

  async function saveCover(url: string | null) {
    await patch('/api/suppliers/hub/discovery', {
      business_id: business!.id,
      cover_image_url: url,
    });
    onCoverChange(url);
  }

  async function pick(kind: 'logo' | 'cover', file: File | undefined) {
    if (!file) return;
    setBusy(kind);
    try {
      const blob = await shrink(file, kind === 'logo' ? LOGO_MAX_PX : COVER_MAX_PX, kind === 'logo');
      const url = await upload(blob, kind);
      if (kind === 'logo') await saveLogo(url);
      else await saveCover(url);
      toast.success(kind === 'logo' ? 'Logo updated' : 'Cover photo updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(null);
      if (logoInput.current) logoInput.current.value = '';
      if (coverInput.current) coverInput.current.value = '';
    }
  }

  async function remove(kind: 'logo' | 'cover') {
    const ask =
      kind === 'logo' ? 'Remove your logo? It is also removed from your invoices.' : 'Remove your cover photo?';
    if (!confirm(ask)) return;
    setBusy(kind);
    try {
      if (kind === 'logo') await saveLogo(null);
      else await saveCover(null);
      toast.success(kind === 'logo' ? 'Logo removed' : 'Cover photo removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove');
    } finally {
      setBusy(null);
    }
  }

  const tint = supplierTint(business.id);

  return (
    <div className="max-w-2xl space-y-3">
      <div className="relative">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="Your cover photo" className="h-36 w-full rounded-2xl object-cover sm:h-44" />
        ) : (
          <div
            aria-hidden="true"
            className={`h-36 w-full rounded-2xl sm:h-44 ${tint.cover} bg-[repeating-linear-gradient(135deg,transparent_0_18px,rgba(255,255,255,0.35)_18px_36px)]`}
          />
        )}
        <div className="absolute -bottom-8 left-4">
          <SupplierAvatar
            id={business.id}
            name={business.name}
            logoUrl={logoUrl}
            className="h-20 w-20 !border-4 !border-surface text-2xl"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-9 sm:flex-row sm:flex-wrap">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={logoInput}
            id="hub-logo-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => pick('logo', e.target.files?.[0])}
          />
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => logoInput.current?.click()}>
            {busy === 'logo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {logoUrl ? 'Change logo' : 'Upload logo'}
          </Button>
          {logoUrl && (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => remove('logo')}>
              <Trash2 className="h-4 w-4" />
              Remove logo
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={coverInput}
            id="hub-cover-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => pick('cover', e.target.files?.[0])}
          />
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => coverInput.current?.click()}>
            {busy === 'cover' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {coverUrl ? 'Change cover photo' : 'Upload cover photo'}
          </Button>
          {coverUrl && (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => remove('cover')}>
              <Trash2 className="h-4 w-4" />
              Remove cover
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-text-secondary">
        Logo: square works best; it is the same logo printed on your invoices. Cover: a wide photo of your shop front
        or warehouse.
      </p>
    </div>
  );
}
