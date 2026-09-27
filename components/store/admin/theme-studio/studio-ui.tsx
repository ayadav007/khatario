'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, Loader2, Search, X } from 'lucide-react';
import type { StoreCategoryStyle } from '@/lib/store/store-theme';
import { StudioCategoryTiles } from '@/components/store/studio-theme/StudioSections';

export interface StudioProduct {
  id: string;
  name: string;
  unit: string;
  price: number;
  mrp: number | null;
  image: string;
}

export interface StudioCategory {
  id: string;
  name: string;
  image: string;
}

const CATEGORY_FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1599599810694-b5ac4dd4f6e6?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=500&q=80',
  'https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=500&q=80',
];

export function categoryFallbackImage(index: number): string {
  return CATEGORY_FALLBACK_IMAGES[index % CATEGORY_FALLBACK_IMAGES.length];
}

export async function uploadStoreImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', 'promo');
  formData.append('folder', 'store');
  const res = await fetch('/api/upload/image', { method: 'POST', body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.url !== 'string') throw new Error(data.error || 'Upload failed');
  return data.url;
}

export { rupees, IconGlyph, isIconSvg } from '@/components/store/studio-theme/StudioSections';

/** True when the theme being edited renders every Studio field (the Studio pack). */
export const StudioLayoutContext = createContext(true);

/** Labels ending in ◇ only affect the Studio pack; the marker is dropped when that pack is active. */
function useLabel(label: string): string {
  const full = useContext(StudioLayoutContext);
  return full ? label.replace(/\s*◇$/, '') : label;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{useLabel(label)}</span>
      {children}
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const text = useLabel(label);
  return (
    <label className="field checkRow">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{text}</span>
    </label>
  );
}

export function ImagePicker({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadStoreImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="imageField">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {value ? <img src={value} alt="" /> : null}
        <label className={`fileBtn ${busy ? 'busy' : ''}`}>
          {busy ? 'Uploading…' : value ? 'Change image' : 'Upload image'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      </div>
      <input
        className="urlInput"
        value={value.startsWith('data:') ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Or paste https://…"
      />
      {error ? <small style={{ color: '#b91c1c', float: 'none' }}>{error}</small> : null}
    </>
  );
}

const ICONIFY_API = 'https://api.iconify.design';

/** Permissively licensed sets only (MIT / Apache / ISC), so no attribution is required on the storefront. */
const FREE_ICON_SETS = ['lucide', 'tabler', 'mdi', 'ph', 'heroicons', 'material-symbols', 'ri', 'bi', 'iconoir', 'fluent'];

const ICON_NAME = /^[a-z0-9-]+:[a-z0-9-]+$/;

export interface PickedIcon {
  name: string;
  /** Self-contained SVG data URL, so the storefront never depends on Iconify being reachable. */
  svg: string;
}

interface IconifySetResponse {
  width?: number;
  height?: number;
  left?: number;
  top?: number;
  icons?: Record<string, { body: string; width?: number; height?: number; left?: number; top?: number }>;
  aliases?: Record<string, { parent: string }>;
}

function svgDataUrl(body: string, left: number, top: number, width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * One request per icon set. Iconify rate-limits its per-icon SVG URLs (HTTP 429),
 * so never load dozens of `/{set}/{icon}.svg` images at once.
 */
async function fetchIconSvgs(names: string[], signal?: AbortSignal): Promise<Record<string, string>> {
  const byPrefix = new Map<string, string[]>();
  for (const n of names) {
    const [prefix, icon] = n.split(':');
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), icon]);
  }
  const out: Record<string, string> = {};
  await Promise.all(
    [...byPrefix].map(async ([prefix, icons]) => {
      const res = await fetch(`${ICONIFY_API}/${prefix}.json?icons=${icons.join(',')}`, { signal });
      if (!res.ok) return;
      const data: IconifySetResponse = await res.json();
      for (const icon of icons) {
        const entry = data.icons?.[icon] ?? data.icons?.[data.aliases?.[icon]?.parent ?? ''];
        if (!entry?.body) continue;
        out[`${prefix}:${icon}`] = svgDataUrl(
          entry.body,
          entry.left ?? data.left ?? 0,
          entry.top ?? data.top ?? 0,
          entry.width ?? data.width ?? 16,
          entry.height ?? data.height ?? 16,
        );
      }
    }),
  );
  return out;
}

export function IconPicker({
  title,
  initialQuery,
  current,
  onPick,
  onClose,
}: {
  title: string;
  initialQuery: string;
  current?: string;
  onPick: (icon: PickedIcon | undefined) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [icons, setIcons] = useState<Array<PickedIcon>>([]);
  const [licenses, setLicenses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setIcons([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ query: q, limit: '96', prefixes: FREE_ICON_SETS.join(',') });
        const res = await fetch(`${ICONIFY_API}/search?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error('Icon search failed');
        const data: {
          icons?: string[];
          collections?: Record<string, { name?: string; license?: { title?: string } }>;
        } = await res.json();
        const names = (data.icons ?? []).filter((n) => ICON_NAME.test(n));
        const svgs = await fetchIconSvgs(names, ctrl.signal);
        setIcons(names.filter((n) => svgs[n]).map((name) => ({ name, svg: svgs[name] })));
        const lic: Record<string, string> = {};
        for (const [prefix, c] of Object.entries(data.collections ?? {})) {
          lic[prefix] = `${c.name ?? prefix} · ${c.license?.title ?? 'Open source'}`;
        }
        setLicenses(lic);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('Could not reach the free icon library. Check your internet connection.');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="iconModalBack" onClick={onClose}>
      <div className="iconModal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="iconModalHead">
          <b>{title}</b>
          <button type="button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="iconSearch">
          <Search />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search free icons, e.g. bag, basket, user" />
          {loading ? <Loader2 className="animate-spin" /> : null}
        </div>
        <p className="styleHint" style={{ margin: '0 0 10px' }}>
          Free, open-source icons (MIT / Apache / ISC) from Lucide, Tabler, Material and more via Iconify. Free to use, no credit needed.
        </p>
        {error ? <p className="note warnNote" style={{ margin: '0 0 10px' }}>{error}</p> : null}
        <div className="iconGrid">
          {icons.map((icon) => (
            <button
              type="button"
              key={icon.name}
              className={current === icon.name ? 'on' : ''}
              title={`${icon.name}\n${licenses[icon.name.split(':')[0]] ?? ''}`}
              onClick={() => onPick(icon)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon.svg} alt={icon.name} />
            </button>
          ))}
          {!loading && !error && query.trim() && icons.length === 0 ? <p className="styleHint">No icons found. Try another word.</p> : null}
        </div>
        <form
          className="iconPaste"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = pasted.trim().toLowerCase();
            if (!ICON_NAME.test(name)) return setPasteError('Use the format set:icon, e.g. mdi:cart-outline');
            if (!FREE_ICON_SETS.includes(name.split(':')[0])) {
              return setPasteError(`Only these free sets are allowed: ${FREE_ICON_SETS.join(', ')}`);
            }
            try {
              const svg = (await fetchIconSvgs([name]))[name];
              if (!svg) return setPasteError('That icon was not found. Check the name on Iconify.');
              onPick({ name, svg });
            } catch {
              setPasteError('Could not reach the free icon library. Check your internet connection.');
            }
          }}
        >
          <input
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              setPasteError(null);
            }}
            placeholder="Or paste an icon name from Iconify, e.g. tabler:basket"
          />
          <button type="submit">Use</button>
        </form>
        {pasteError ? <p className="note warnNote" style={{ margin: '6px 0 0' }}>{pasteError}</p> : null}
        <div className="iconModalFoot">
          <button type="button" className="linkBtn" onClick={() => onPick(undefined)}>
            Use theme default icon
          </button>
          <a href={`https://icon-sets.iconify.design/?query=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer" className="linkBtn">
            Browse all on Iconify <ExternalLink style={{ width: 12, height: 12 }} />
          </a>
        </div>
      </div>
    </div>
  );
}

/** Category tiles rendered the way the storefront's category style would show them. */
export function CategoryTiles({
  categories,
  style,
  images,
  columns,
}: {
  categories: StudioCategory[];
  style: StoreCategoryStyle;
  images: Record<string, string>;
  columns: number;
}) {
  return <StudioCategoryTiles categories={categories} style={style} images={images} columns={columns} />;
}
