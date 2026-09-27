'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { storeHostSuffix } from '@/lib/store/subdomain';
import {
  applyStorePreset,
  sanitizeStoreTheme,
  storeCanvas,
  type StoreAppearanceMode,
  type StoreTheme,
  type StoreThemePack,
  type StoreThemePreset,
} from '@/lib/store/store-theme';
import { sanitizeStudioDraft } from '@/lib/store/studio-draft';
import {
  ThemeStudio,
  categoryFallbackImage,
  type StudioCategory,
  type StudioProduct,
  type StudioSaveState,
} from '@/components/store/admin/theme-studio/ThemeStudio';
import {
  STUDIO_PAGES,
  buildStudioTheme,
  pagesFromSettings,
  resolveStudioSections,
  type StudioPageId,
  type StudioPagesState,
  type StudioSection,
} from '@/components/store/admin/theme-studio/studio-map';

const SAMPLE_PRODUCTS: StudioProduct[] = [
  { id: 's1', name: 'Fresh Tomato', unit: '1 kg', price: 36, mrp: 40, image: 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=400&q=80' },
  { id: 's2', name: 'Whole Wheat Atta', unit: '5 kg', price: 260, mrp: null, image: 'https://images.unsplash.com/photo-1627485937980-221c88ac04f9?auto=format&fit=crop&w=400&q=80' },
  { id: 's3', name: 'Toned Milk', unit: '1 L', price: 58, mrp: null, image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=400&q=80' },
  { id: 's4', name: 'Basmati Rice', unit: '5 kg', price: 523, mrp: 550, image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=400&q=80' },
  { id: 's5', name: 'Sunflower Oil', unit: '1 L', price: 140, mrp: null, image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=400&q=80' },
];

const SAMPLE_CATEGORY_NAMES = ['Fruits & Vegetables', 'Staples', 'Snacks', 'Beverages', 'Personal Care', 'Household'];

const AUTOSAVE_MS = 1200;
const LIVE_PREVIEW_MS = 900;

interface Doc {
  sections: StudioSection[];
  pages: StudioPagesState;
}

interface Loaded {
  liveTheme: StoreTheme;
  liveDoc: Doc;
  subdomain: string;
  businessLogo: string;
  products: StudioProduct[];
  realProductId: string | null;
  categories: StudioCategory[];
}

function formatSavedAt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function ThemeStudioPage() {
  const { business, user } = useAuth();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [theme, setTheme] = useState<StoreTheme | null>(null);
  const [initialDoc, setInitialDoc] = useState<Doc | null>(null);
  const [docKey, setDocKey] = useState(0);
  const [livePack, setLivePack] = useState<StoreThemePack>('studio');
  const [resumedAt, setResumedAt] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saveState, setSaveState] = useState<StudioSaveState>('idle');
  const [livePreviewSrc, setLivePreviewSrc] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const docRef = useRef<Doc | null>(null);
  const themeRef = useRef<StoreTheme | null>(null);
  const saveTimer = useRef<number>();
  const dirty = useRef(false);
  themeRef.current = theme;

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [res, draftRes] = await Promise.all([
          fetch(`/api/settings/online-store?business_id=${business.id}&user_id=${user.id}`, { credentials: 'include' }),
          fetch(`/api/settings/online-store/studio-draft?business_id=${business.id}`, { credentials: 'include' }),
        ]);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Failed to load settings');
        const draftBody = draftRes.ok ? await draftRes.json().catch(() => ({})) : {};

        const liveTheme = sanitizeStoreTheme(body.store_theme);
        const subdomain: string = body.store_subdomain ?? '';
        const cats: Array<{ id: string; name: string }> = body.categories ?? [];

        let products = SAMPLE_PRODUCTS;
        let realProductId: string | null = null;
        if (subdomain) {
          try {
            const itemsRes = await fetch(`/api/public/store/${encodeURIComponent(subdomain)}/items?limit=10&td=1`);
            if (itemsRes.ok) {
              const itemsBody = await itemsRes.json();
              const rows: StudioProduct[] = (itemsBody.items ?? []).map(
                (i: { id: string; name: string; unit: string; selling_price: number; mrp: number | null; images?: string[]; image_url?: string | null }) => ({
                  id: i.id,
                  name: i.name,
                  unit: i.unit,
                  price: i.selling_price,
                  mrp: i.mrp,
                  image: i.images?.[0] || i.image_url || '',
                }),
              );
              if (rows.length) {
                products = rows;
                realProductId = rows[0].id;
              }
            }
          } catch {
            // Sample products keep the preview usable when the catalog can't be fetched.
          }
        }

        const categories: StudioCategory[] = cats.length
          ? cats.slice(0, 6).map((c, idx) => ({
              id: c.id,
              name: c.name,
              image: liveTheme.category_images[c.id] || categoryFallbackImage(idx),
            }))
          : SAMPLE_CATEGORY_NAMES.map((name, idx) => ({ id: `sample-${idx}`, name, image: categoryFallbackImage(idx) }));

        const liveDoc: Doc = {
          sections: resolveStudioSections(liveTheme, {
            businessName: business.name ?? '',
            tagline: body.store_tagline ?? '',
            heroUrl: body.store_hero_image_url ?? '',
            categories: cats,
            autoAnnouncement: '',
          }),
          pages: pagesFromSettings(liveTheme, body),
        };

        const draft = sanitizeStudioDraft(draftBody.draft);
        if (cancelled) return;
        setLivePack(liveTheme.pack);
        setData({ liveTheme, liveDoc, subdomain, businessLogo: body.logo_url ?? '', products, realProductId, categories });
        if (draft) {
          const doc = { sections: draft.sections.length ? draft.sections : liveDoc.sections, pages: draft.pages };
          setTheme(draft.theme);
          setInitialDoc(doc);
          docRef.current = doc;
          setResumedAt(draftBody.saved_at ?? '');
          setHasDraft(true);
        } else {
          setTheme(liveTheme);
          setInitialDoc(liveDoc);
          docRef.current = liveDoc;
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load settings');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, business?.name, user?.id]);

  const draftPayload = useCallback(() => {
    const t = themeRef.current;
    const d = docRef.current;
    if (!t || !d || !business?.id) return null;
    return JSON.stringify({ business_id: business.id, draft: { theme: t, sections: d.sections, pages: d.pages } });
  }, [business?.id]);

  const saveDraft = useCallback(async () => {
    const payload = draftPayload();
    if (!payload) return;
    dirty.current = false;
    setSaveState('saving');
    try {
      const res = await fetch('/api/settings/online-store/studio-draft', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      if (!res.ok) throw new Error();
      setHasDraft(true);
      setSaveState(dirty.current ? 'saving' : 'saved');
    } catch {
      dirty.current = true;
      setSaveState('error');
    }
  }, [draftPayload]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaveState('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveDraft(), AUTOSAVE_MS);
  }, [saveDraft]);

  // Closing the tab mid-debounce would lose the last edit; keepalive lets the request finish.
  useEffect(() => {
    const flush = () => {
      if (!dirty.current) return;
      const payload = draftPayload();
      if (!payload) return;
      void fetch('/api/settings/online-store/studio-draft', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      });
      dirty.current = false;
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [draftPayload]);

  const firstTheme = useRef(true);
  useEffect(() => {
    if (!theme) return;
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    scheduleSave();
  }, [theme, scheduleSave]);

  const storefrontBase = useCallback(() => {
    if (!data?.subdomain) return null;
    const suffix = storeHostSuffix(window.location.hostname);
    const port = suffix === '.localhost' && window.location.port ? `:${window.location.port}` : '';
    return `${window.location.protocol}//${data.subdomain}${suffix}${port}`;
  }, [data?.subdomain]);

  const signDraft = useCallback(
    async (next: StoreTheme) => {
      const res = await fetch('/api/settings/online-store/preview-draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business?.id,
          theme: sanitizeStoreTheme({ ...next, logo_url: next.logo_url || data?.businessLogo }),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.token !== 'string') throw new Error(body.error || 'Could not build preview');
      return body.token as string;
    },
    [business?.id, data?.businessLogo],
  );

  const [previewTick, setPreviewTick] = useState(0);
  useEffect(() => {
    if (!theme || theme.pack === 'studio') return;
    const base = storefrontBase();
    if (!base) return;
    const t = window.setTimeout(async () => {
      const d = docRef.current;
      if (!d) return;
      try {
        const token = await signDraft(buildStudioTheme(theme, d.sections, d.pages).theme);
        setLivePreviewSrc(`${base}/?td=${encodeURIComponent(token)}`);
      } catch {
        // Keep the last good preview on a transient failure.
      }
    }, LIVE_PREVIEW_MS);
    return () => window.clearTimeout(t);
  }, [theme, previewTick, storefrontBase, signDraft]);

  const onDocChange = useCallback(
    (sections: StudioSection[], pages: StudioPagesState) => {
      docRef.current = { sections, pages };
      scheduleSave();
      setPreviewTick((n) => n + 1);
    },
    [scheduleSave],
  );

  const onAccentChange = useCallback((hex: string) => {
    setTheme((t) => (t ? { ...t, preset: 'custom', accent: hex } : t));
  }, []);

  const onAppearanceChange = useCallback((appearance_mode: StoreAppearanceMode) => {
    setTheme((t) => (t ? { ...t, appearance_mode, background: storeCanvas({ pack: t.pack, appearance_mode }) } : t));
  }, []);

  const onChooseTheme = useCallback((preset: Exclude<StoreThemePreset, 'custom'>) => {
    setLivePreviewSrc(null);
    setTheme((t) => {
      if (!t) return t;
      const p = applyStorePreset(preset);
      // The merchant's brand colour and page colour carry over; only the design changes.
      return sanitizeStoreTheme({
        ...t,
        pack: p.pack,
        preset: 'custom',
        accent: t.accent,
        homepage_sections: p.homepage_sections ?? t.homepage_sections,
      });
    });
  }, []);

  const onDiscard = useCallback(async () => {
    if (!data || !business?.id) return;
    if (!window.confirm('Discard all unpublished changes and go back to your live store design?')) return;
    window.clearTimeout(saveTimer.current);
    dirty.current = false;
    await fetch(`/api/settings/online-store/studio-draft?business_id=${business.id}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => undefined);
    firstTheme.current = true;
    docRef.current = data.liveDoc;
    setTheme(data.liveTheme);
    setInitialDoc(data.liveDoc);
    setDocKey((k) => k + 1);
    setResumedAt(null);
    setHasDraft(false);
    setSaveState('idle');
    setLivePreviewSrc(null);
  }, [data, business?.id]);

  const onPreview = useCallback(
    async (sections: StudioSection[], pages: StudioPagesState, page: StudioPageId) => {
      if (!theme || !data) return;
      const base = storefrontBase();
      if (!base) {
        setMessage({ kind: 'err', text: 'Set a store URL under Store setup first.' });
        return;
      }
      let path = STUDIO_PAGES.find((p) => p.id === page)?.path ?? '/';
      if (path.includes(':id')) {
        if (!data.realProductId) {
          setMessage({ kind: 'err', text: 'Add an item with “Show in store” turned on to preview the product page.' });
          return;
        }
        path = path.replace(':id', encodeURIComponent(data.realProductId));
      }
      const tab = window.open('about:blank', '_blank');
      setPreviewing(true);
      setMessage(null);
      try {
        const token = await signDraft(buildStudioTheme(theme, sections, pages).theme);
        const url = `${base}${path}?td=${encodeURIComponent(token)}`;
        if (tab) tab.location.href = url;
        else window.open(url, '_blank');
      } catch (e) {
        tab?.close();
        setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not build preview' });
      } finally {
        setPreviewing(false);
      }
    },
    [theme, data, storefrontBase, signDraft],
  );

  const onPublish = useCallback(
    async (sections: StudioSection[], pages: StudioPagesState) => {
      if (!theme || !business?.id || !data) return;
      if (!window.confirm('Publish these changes to your live store?')) return;
      setSaving(true);
      setMessage(null);
      try {
        const { theme: built, tagline, heroImage } = buildStudioTheme(theme, sections, pages);
        const next = sanitizeStoreTheme(built);
        const res = await fetch('/api/settings/online-store', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: business.id,
            store_theme: next,
            store_tagline: tagline,
            store_min_order_amount: pages.minOrder,
            store_allow_cod: pages.allowCod,
            store_about_md: pages.aboutMd.trim() || null,
            store_contact_md: pages.contactMd.trim() || null,
            ...(heroImage ? { store_hero_image_url: heroImage } : {}),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Failed to publish');
        window.clearTimeout(saveTimer.current);
        dirty.current = false;
        await fetch(`/api/settings/online-store/studio-draft?business_id=${business.id}`, {
          method: 'DELETE',
          credentials: 'include',
        }).catch(() => undefined);
        const liveDoc = { sections: next.studio_sections.length ? next.studio_sections : sections, pages };
        setData({ ...data, liveTheme: next, liveDoc });
        setLivePack(next.pack);
        setResumedAt(null);
        setHasDraft(false);
        setSaveState('idle');
        setMessage({ kind: 'ok', text: 'Published to your live store.' });
      } catch (e) {
        setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to publish' });
      } finally {
        setSaving(false);
      }
    },
    [theme, business?.id, data],
  );

  if (loadError) {
    return <div className="p-8 text-sm text-red-600">{loadError}</div>;
  }
  if (!data || !theme || !initialDoc) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const savedLabel = formatSavedAt(resumedAt);
  return (
    <ThemeStudio
      key={docKey}
      initialSections={initialDoc.sections}
      initialPages={initialDoc.pages}
      contactFallback={{ phone: business?.phone, email: business?.email }}
      accent={theme.accent}
      onAccentChange={onAccentChange}
      appearance={theme.appearance_mode}
      canvas={storeCanvas(theme)}
      onAppearanceChange={onAppearanceChange}
      pack={theme.pack}
      livePack={livePack}
      onChooseTheme={onChooseTheme}
      livePreviewSrc={livePreviewSrc}
      logoUrl={theme.logo_url || data.businessLogo}
      products={data.products}
      categories={data.categories}
      testimonials={theme.testimonials}
      saving={saving}
      previewing={previewing}
      saveState={saveState}
      notice={
        resumedAt !== null || hasDraft ? (
          <>
            <span>
              {resumedAt !== null
                ? `Resumed your unpublished changes${savedLabel ? ` from ${savedLabel}` : ''}.`
                : 'Your changes are saved as a draft.'}{' '}
              Shoppers still see the live design until you Publish.
            </span>
            <button type="button" onClick={() => void onDiscard()}>
              Discard changes
            </button>
          </>
        ) : null
      }
      message={message}
      onChange={onDocChange}
      onPublish={(s, p) => void onPublish(s, p)}
      onPreview={(s, p, pg) => void onPreview(s, p, pg)}
    />
  );
}
