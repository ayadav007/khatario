'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { StoreImageField } from '@/components/store/admin/StoreImageField';
import {
  SEO_DESC_MAX,
  SEO_TITLE_MAX,
  resolveItemSeo,
  seoDescriptionQuality,
  seoTitleQuality,
} from '@/lib/store/item-seo';
import { storeHostSuffix } from '@/lib/store/subdomain';

function qualityLabel(kind: 'empty' | 'short' | 'ok' | 'long'): { text: string; className: string } {
  if (kind === 'ok') return { text: 'Good length', className: 'text-green-600' };
  if (kind === 'short') return { text: 'A bit short', className: 'text-amber-600' };
  if (kind === 'long') return { text: 'May get cut off', className: 'text-amber-600' };
  return { text: 'Using the item name until you write one', className: 'text-gray-400' };
}

export function ItemSeoFields({
  businessId,
  itemId,
  itemName,
  itemDescription,
  itemImageUrl,
  itemBrand,
  itemCategory,
  seoTitle,
  seoDescription,
  seoImageUrl,
  onChange,
}: {
  businessId?: string;
  itemId?: string | null;
  itemName: string;
  itemDescription: string;
  itemImageUrl: string;
  itemBrand?: string;
  itemCategory?: string;
  seoTitle: string;
  seoDescription: string;
  seoImageUrl: string;
  onChange: (patch: { seo_title?: string; seo_description?: string; seo_image_url?: string }) => void;
}) {
  const [storePath, setStorePath] = useState('yourstore.khatario.com');
  const [busy, setBusy] = useState<'title' | 'description' | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    void fetch(`/api/settings/online-store?business_id=${encodeURIComponent(businessId)}`, {
      credentials: 'include',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const slug = typeof data?.store_subdomain === 'string' ? data.store_subdomain.trim() : '';
        const suffix = storeHostSuffix(window.location.hostname);
        const host = slug ? `${slug}${suffix}` : `yourstore${suffix}`;
        const port = suffix === '.localhost' && window.location.port ? `:${window.location.port}` : '';
        setStorePath(`${host}${port}`);
      })
      .catch(() => undefined);
  }, [businessId]);

  const resolved = useMemo(
    () =>
      resolveItemSeo({
        name: itemName,
        description: itemDescription,
        image_url: itemImageUrl,
        seo_title: seoTitle,
        seo_description: seoDescription,
        seo_image_url: seoImageUrl,
      }),
    [itemName, itemDescription, itemImageUrl, seoTitle, seoDescription, seoImageUrl],
  );

  const productPath = itemId ? `/products/${itemId}` : '/products/…';
  const previewUrl = `https://${storePath}${productPath}`;
  const titleHint = qualityLabel(seoTitleQuality(seoTitle || resolved.title));
  const descHint = qualityLabel(seoDescriptionQuality(seoDescription || resolved.description));

  const generate = async (field: 'title' | 'description') => {
    if (!itemName.trim()) {
      setGenError('Enter the item name first.');
      return;
    }
    setGenError(null);
    setBusy(field);
    try {
      const res = await fetch('/api/items/seo-suggest', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          field,
          name: itemName,
          description: itemDescription,
          brand: itemBrand,
          category: itemCategory,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenError(typeof data.error === 'string' ? data.error : 'Could not generate');
        return;
      }
      if (field === 'title' && typeof data.title === 'string') {
        onChange({ seo_title: data.title });
      }
      if (field === 'description' && typeof data.description === 'string') {
        onChange({ seo_description: data.description });
      }
    } catch {
      setGenError('Could not generate');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="flex items-center justify-between text-xs font-medium text-gray-600">
          Title tag
          <span className={titleHint.className}>{titleHint.text}</span>
        </span>
        <input
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          maxLength={SEO_TITLE_MAX}
          value={seoTitle}
          onChange={(e) => onChange({ seo_title: e.target.value.slice(0, SEO_TITLE_MAX) })}
          placeholder={itemName.trim() || 'Premium Quality Water Bottles | Stay Hydrated On The Go'}
        />
        <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-gray-400">
          <span>
            {(seoTitle || resolved.title).length}/{SEO_TITLE_MAX} · shown as the blue headline in Google
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void generate('title')}
          >
            {busy === 'title' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Generate title
          </button>
        </span>
      </label>

      <label className="block">
        <span className="flex items-center justify-between text-xs font-medium text-gray-600">
          Meta description
          <span className={descHint.className}>{descHint.text}</span>
        </span>
        <textarea
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          rows={3}
          maxLength={SEO_DESC_MAX}
          value={seoDescription}
          onChange={(e) => onChange({ seo_description: e.target.value.slice(0, SEO_DESC_MAX) })}
          placeholder="Explore our range of durable, leak-proof water bottles…"
        />
        <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-gray-400">
          <span>
            {(seoDescription || resolved.description).length}/{SEO_DESC_MAX} · grey snippet under the title
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void generate('description')}
          >
            {busy === 'description' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Generate meta description
          </button>
        </span>
      </label>
      {genError ? <p className="text-[11px] text-red-600">{genError}</p> : null}

      <StoreImageField
        label="Social sharing image"
        hint="Used when this product is shared on WhatsApp or Facebook. Leave empty to use the product photo."
        value={seoImageUrl}
        onChange={(url) => onChange({ seo_image_url: url })}
      />

      <div className="rounded-xl border bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Social sharing preview</p>
        <div className="mt-2 flex gap-3">
          <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
            {resolved.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolved.image} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">No image</div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-800">{resolved.title}</p>
            <p className="truncate text-[11px] text-gray-400">{previewUrl}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{resolved.description}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Google search preview</p>
        <p className="mt-2 truncate text-[12px] text-gray-500">{previewUrl.replace(/^https:\/\//, '')}</p>
        <p className="truncate text-[18px] leading-snug text-[#1a0dab]">{resolved.title}</p>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-gray-600">{resolved.description}</p>
      </div>
    </div>
  );
}
