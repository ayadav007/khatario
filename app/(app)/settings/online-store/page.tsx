'use client';

import { useState, useEffect, useCallback } from 'react';
import { Store, ExternalLink, Loader2, Copy, Check, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DeliveryZoneEditor } from '@/components/store/admin/DeliveryZoneEditor';
import { StoreImageField } from '@/components/store/admin/StoreImageField';
import { StoreLivePreview } from '@/components/store/admin/StoreLivePreview';
import { StoreCouponManager } from '@/components/store/admin/StoreCouponManager';
import { storeHostSuffix } from '@/lib/store/subdomain';
import {
  DEFAULT_STORE_PROMO,
  nextPromoSheetVersion,
  sanitizeStorePromoSheet,
  type StorePromoSheetConfig,
} from '@/lib/store/promo-sheet';
import {
  DEFAULT_STORE_THEME,
  STORE_THEME_PRESETS,
  applyStorePreset,
  sanitizeStoreTheme,
  type StoreTheme,
  type StoreThemePreset,
} from '@/lib/store/store-theme';
import clsx from 'clsx';

type EditorTab = 'design' | 'homepage' | 'promo' | 'checkout' | 'pages';

interface StoreSettings {
  store_subdomain: string | null;
  store_enabled: boolean;
  store_tagline: string | null;
  store_hero_image_url: string | null;
  store_min_order_amount: number;
  store_allow_cod?: boolean;
  store_delivery_provider?: string;
  store_about_md?: string | null;
  store_contact_md?: string | null;
  store_theme?: unknown;
  store_hide_khatario_badge?: boolean;
  store_shiprocket_email?: string | null;
  store_promo_sheet?: StorePromoSheetConfig | null;
  logo_url?: string | null;
  categories?: Array<{ id: string; name: string }>;
}

const TABS: Array<{ id: EditorTab; label: string }> = [
  { id: 'design', label: 'Design' },
  { id: 'homepage', label: 'Homepage' },
  { id: 'promo', label: 'Promo' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'pages', label: 'Pages' },
];

function Toggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        on ? 'bg-green-500' : 'bg-gray-200',
      )}
    >
      <span
        className={clsx(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow',
          on ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export default function OnlineStoreSettingsPage() {
  const { business, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hostSuffix, setHostSuffix] = useState('.khatario.com');
  const [tab, setTab] = useState<EditorTab>('design');
  const [showPreview, setShowPreview] = useState(true);

  const [subdomain, setSubdomain] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [tagline, setTagline] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [heroUrl, setHeroUrl] = useState('');
  const [aboutMd, setAboutMd] = useState('');
  const [contactMd, setContactMd] = useState('');
  const [allowCod, setAllowCod] = useState(true);
  const [deliveryProvider, setDeliveryProvider] = useState('self');
  const [hideBadge, setHideBadge] = useState(false);
  const [shipEmail, setShipEmail] = useState('');
  const [shipPassword, setShipPassword] = useState('');
  const [promo, setPromo] = useState<StorePromoSheetConfig>(DEFAULT_STORE_PROMO);
  const [savedPromo, setSavedPromo] = useState<StorePromoSheetConfig>(DEFAULT_STORE_PROMO);
  const [theme, setTheme] = useState<StoreTheme>(DEFAULT_STORE_THEME);
  const [businessLogo, setBusinessLogo] = useState('');
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);

  const fetchSettings = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/settings/online-store?business_id=${business.id}&user_id=${user.id}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const data: StoreSettings = await res.json();
        setSubdomain(data.store_subdomain ?? '');
        setEnabled(data.store_enabled);
        setTagline(data.store_tagline ?? '');
        setMinOrder(data.store_min_order_amount ? String(data.store_min_order_amount) : '');
        setHeroUrl(data.store_hero_image_url ?? '');
        setAboutMd(data.store_about_md ?? '');
        setContactMd(data.store_contact_md ?? '');
        setAllowCod(data.store_allow_cod !== false);
        setDeliveryProvider(data.store_delivery_provider ?? 'self');
        const nextTheme = sanitizeStoreTheme(data.store_theme);
        if (nextTheme.hero_slides.length === 0 && data.store_hero_image_url) {
          nextTheme.hero_slides = [
            {
              image_url: data.store_hero_image_url,
              title: data.store_tagline ?? '',
              subtitle: nextTheme.hero_subtitle,
            },
          ];
        }
        setTheme(nextTheme);
        setBusinessLogo(data.logo_url ?? '');
        setHideBadge(!!data.store_hide_khatario_badge);
        setShipEmail(data.store_shiprocket_email ?? '');
        const nextPromo = sanitizeStorePromoSheet(data.store_promo_sheet);
        setPromo(nextPromo);
        setSavedPromo(nextPromo);
        setCategories(data.categories ?? []);
      }
    } catch {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    setHostSuffix(storeHostSuffix(window.location.hostname));
  }, []);

  const handleSave = useCallback(async () => {
    if (!business?.id) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('/api/settings/online-store', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          store_subdomain: subdomain.trim() || null,
          store_enabled: enabled,
          store_tagline: tagline.trim() || null,
          store_min_order_amount: parseFloat(minOrder) || 0,
          store_hero_image_url: theme.hero_slides[0]?.image_url || heroUrl.trim() || null,
          store_about_md: aboutMd || null,
          store_contact_md: contactMd || null,
          store_allow_cod: allowCod,
          store_delivery_provider: deliveryProvider,
          store_theme: sanitizeStoreTheme(theme),
          store_hide_khatario_badge: hideBadge,
          store_shiprocket_email: shipEmail || null,
          store_shiprocket_password: shipPassword || undefined,
          store_promo_sheet: {
            ...sanitizeStorePromoSheet(promo),
            version: nextPromoSheetVersion(savedPromo, sanitizeStorePromoSheet(promo)),
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save');
        return;
      }

      setSuccess(true);
      void fetchSettings();
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [
    business?.id,
    subdomain,
    enabled,
    tagline,
    minOrder,
    heroUrl,
    aboutMd,
    contactMd,
    allowCod,
    deliveryProvider,
    theme,
    hideBadge,
    shipEmail,
    shipPassword,
    promo,
    savedPromo,
    fetchSettings,
  ]);

  const storeUrl = subdomain ? `${subdomain}${hostSuffix}` : null;

  const handleCopy = useCallback(() => {
    if (storeUrl) {
      void navigator.clipboard.writeText(`https://${storeUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [storeUrl]);

  const previewTheme: StoreTheme = {
    ...theme,
    logo_url: theme.logo_url || businessLogo,
  };

  if (loading) {
    return (
      <SettingsPageShell title="Online Store" icon={Store}>
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell
      title="Store editor"
      description="Design your public storefront and see a live phone preview as you change it."
      icon={Store}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs text-gray-500"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      }
    >
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Store saved
        </div>
      ) : null}

      <div className={clsx('gap-6', showPreview && 'xl:grid xl:grid-cols-[minmax(0,1fr)_320px]')}>
        <div>
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={clsx(
                  'flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium',
                  tab === t.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'design' ? (
            <Card className="p-5 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Colour preset</h3>
                <p className="mt-1 text-xs text-gray-500">Pick a look, or set your own colours.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(Object.keys(STORE_THEME_PRESETS) as Array<Exclude<StoreThemePreset, 'custom'>>).map(
                    (key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTheme((t) => ({ ...t, ...applyStorePreset(key) }))}
                        className={clsx(
                          'rounded-full border px-3 py-1.5 text-sm',
                          theme.preset === key ? 'border-gray-900 font-medium' : 'border-gray-200',
                        )}
                      >
                        <span
                          className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: STORE_THEME_PRESETS[key].accent }}
                        />
                        {STORE_THEME_PRESETS[key].label}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    onClick={() => setTheme((t) => ({ ...t, preset: 'custom' }))}
                    className={clsx(
                      'rounded-full border px-3 py-1.5 text-sm',
                      theme.preset === 'custom' ? 'border-gray-900 font-medium' : 'border-gray-200',
                    )}
                  >
                    Custom
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-6">
                <label className="text-xs text-gray-500">
                  Accent
                  <input
                    type="color"
                    className="mt-1 block h-10 w-16"
                    value={theme.accent}
                    onChange={(e) =>
                      setTheme((t) => ({ ...t, preset: 'custom', accent: e.target.value }))
                    }
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Page background
                  <input
                    type="color"
                    className="mt-1 block h-10 w-16"
                    value={theme.background}
                    onChange={(e) =>
                      setTheme((t) => ({ ...t, preset: 'custom', background: e.target.value }))
                    }
                  />
                </label>
              </div>
              <StoreImageField
                label="Store logo"
                hint="Shown in the header. Leave empty to use your business logo."
                value={theme.logo_url}
                onChange={(url) => setTheme((t) => ({ ...t, logo_url: url }))}
              />
              <label className="block text-xs text-gray-500">
                Search placeholder
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
                  value={theme.search_placeholder}
                  onChange={(e) => setTheme((t) => ({ ...t, search_placeholder: e.target.value }))}
                  placeholder="Search atta, oil, soap…"
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Hide “Powered by Khatario”
                  <span className="block text-xs text-gray-500">Available with custom branding on some plans.</span>
                </span>
                <Toggle on={hideBadge} onToggle={() => setHideBadge((v) => !v)} />
              </label>
            </Card>
          ) : null}

          {tab === 'homepage' ? (
            <div className="space-y-4">
              <Card className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Sections</h3>
                <label className="flex items-center justify-between text-sm">
                  Show hero banner
                  <Toggle
                    on={theme.show_hero}
                    onToggle={() => setTheme((t) => ({ ...t, show_hero: !t.show_hero }))}
                  />
                </label>
                <label className="flex items-center justify-between text-sm">
                  Show today&apos;s offers
                  <Toggle
                    on={theme.show_offers}
                    onToggle={() => setTheme((t) => ({ ...t, show_offers: !t.show_offers }))}
                  />
                </label>
                <label className="flex items-center justify-between text-sm">
                  Show trust row
                  <Toggle
                    on={theme.show_trust}
                    onToggle={() => setTheme((t) => ({ ...t, show_trust: !t.show_trust }))}
                  />
                </label>
                <div>
                  <p className="text-sm text-gray-900">Product grid on phone</p>
                  <div className="mt-2 flex gap-2">
                    {([2, 3] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setTheme((t) => ({ ...t, mobile_columns: n }))}
                        className={clsx(
                          'rounded-lg border px-3 py-1.5 text-sm',
                          theme.mobile_columns === n ? 'border-gray-900 font-medium' : 'border-gray-200',
                        )}
                      >
                        {n} columns
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
              <Card className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Hero carousel</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      Add up to 6 banners. They rotate on the store home.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={theme.hero_slides.length >= 6}
                    onClick={() =>
                      setTheme((t) => ({
                        ...t,
                        hero_slides: [
                          ...t.hero_slides,
                          { image_url: '', title: tagline, subtitle: t.hero_subtitle },
                        ],
                      }))
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add slide
                  </Button>
                </div>
                <label className="block text-xs text-gray-500">
                  Default tagline
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={tagline}
                    maxLength={120}
                    onChange={(e) => setTagline(e.target.value)}
                    placeholder="Fresh groceries at your door"
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  Button text
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={theme.hero_cta}
                    onChange={(e) => setTheme((t) => ({ ...t, hero_cta: e.target.value }))}
                  />
                </label>
                {theme.hero_slides.length === 0 ? (
                  <p className="text-xs text-gray-400">No slides yet. Add one to show a banner.</p>
                ) : (
                  theme.hero_slides.map((slide, i) => (
                    <div key={i} className="rounded-xl border border-gray-100 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-700">Slide {i + 1}</p>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Remove slide ${i + 1}`}
                          onClick={() =>
                            setTheme((t) => ({
                              ...t,
                              hero_slides: t.hero_slides.filter((_, idx) => idx !== i),
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <StoreImageField
                        label="Banner image"
                        value={slide.image_url}
                        onChange={(url) =>
                          setTheme((t) => ({
                            ...t,
                            hero_slides: t.hero_slides.map((s, idx) =>
                              idx === i ? { ...s, image_url: url } : s,
                            ),
                          }))
                        }
                      />
                      <label className="block text-xs text-gray-500">
                        Title
                        <input
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                          value={slide.title}
                          onChange={(e) =>
                            setTheme((t) => ({
                              ...t,
                              hero_slides: t.hero_slides.map((s, idx) =>
                                idx === i ? { ...s, title: e.target.value } : s,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className="block text-xs text-gray-500">
                        Subtitle
                        <input
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                          value={slide.subtitle}
                          onChange={(e) =>
                            setTheme((t) => ({
                              ...t,
                              hero_slides: t.hero_slides.map((s, idx) =>
                                idx === i ? { ...s, subtitle: e.target.value } : s,
                              ),
                            }))
                          }
                        />
                      </label>
                    </div>
                  ))
                )}
              </Card>
              <Card className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Categories</h3>
                <p className="text-xs text-gray-500">How aisle tiles look on the store home.</p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['letter', 'Letter'],
                      ['icon', 'Icon'],
                      ['photo', 'Photo'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTheme((t) => ({ ...t, category_style: id }))}
                      className={clsx(
                        'rounded-lg border px-3 py-1.5 text-sm',
                        theme.category_style === id ? 'border-gray-900 font-medium' : 'border-gray-200',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {theme.category_style === 'photo' ? (
                  categories.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      Enable “Show in Store” on items so categories appear, then add photos here.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {categories.map((cat) => (
                        <StoreImageField
                          key={cat.id}
                          label={cat.name}
                          value={theme.category_images[cat.id] ?? ''}
                          onChange={(url) =>
                            setTheme((t) => {
                              const next = { ...t.category_images };
                              if (url) next[cat.id] = url;
                              else delete next[cat.id];
                              return { ...t, category_images: next };
                            })
                          }
                        />
                      ))}
                    </div>
                  )
                ) : null}
              </Card>
            </div>
          ) : null}

          {tab === 'promo' ? (
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Opening promo sheet</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    Slides up as a large poster (about half to three-quarters of the screen). A full-bleed photo works best.
                  </p>
                </div>
                <Toggle
                  on={promo.enabled}
                  onToggle={() => setPromo((p) => ({ ...p, enabled: !p.enabled }))}
                />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-gray-500 sm:col-span-2">
                  Title
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={promo.title}
                    maxLength={80}
                    onChange={(e) => setPromo((p) => ({ ...p, title: e.target.value }))}
                  />
                </label>
                <label className="block text-xs text-gray-500 sm:col-span-2">
                  Message
                  <textarea
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    rows={3}
                    maxLength={400}
                    value={promo.body}
                    onChange={(e) => setPromo((p) => ({ ...p, body: e.target.value }))}
                  />
                </label>
                <div className="sm:col-span-2">
                  <StoreImageField
                    label="Promo image"
                    value={promo.image_url}
                    onChange={(url) => setPromo((p) => ({ ...p, image_url: url }))}
                  />
                </div>
                <label className="block text-xs text-gray-500">
                  Button text
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={promo.cta_label}
                    onChange={(e) => setPromo((p) => ({ ...p, cta_label: e.target.value }))}
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  Button opens
                  <select
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={promo.cta_action}
                    onChange={(e) =>
                      setPromo((p) => ({
                        ...p,
                        cta_action: e.target.value as StorePromoSheetConfig['cta_action'],
                      }))
                    }
                  >
                    <option value="checkout">Checkout</option>
                    <option value="cart">Cart</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="url">Custom link</option>
                    <option value="none">No button</option>
                  </select>
                </label>
                {promo.cta_action === 'url' ? (
                  <label className="block text-xs text-gray-500 sm:col-span-2">
                    Custom link
                    <input
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                      value={promo.cta_url}
                      onChange={(e) => setPromo((p) => ({ ...p, cta_url: e.target.value }))}
                    />
                  </label>
                ) : null}
                <label className="block text-xs text-gray-500">
                  Coupon to apply
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm uppercase"
                    value={promo.coupon_code}
                    onChange={(e) =>
                      setPromo((p) => ({ ...p, coupon_code: e.target.value.toUpperCase() }))
                    }
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  How often
                  <select
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={promo.frequency}
                    onChange={(e) =>
                      setPromo((p) => ({
                        ...p,
                        frequency: e.target.value as StorePromoSheetConfig['frequency'],
                      }))
                    }
                  >
                    <option value="every_visit">Every visit</option>
                    <option value="once_per_session">Once per session</option>
                    <option value="once_per_day">Once per day</option>
                    <option value="until_dismissed">Until they dismiss it</option>
                  </select>
                </label>
                <label className="block text-xs text-gray-500">
                  Wait before showing (seconds)
                  <input
                    type="number"
                    min={0}
                    max={8}
                    step={0.1}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={Math.round((promo.delay_ms / 1000) * 10) / 10}
                    onChange={(e) =>
                      setPromo((p) => ({
                        ...p,
                        delay_ms: Math.round((Number(e.target.value) || 0) * 1000),
                      }))
                    }
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={promo.dismissible}
                    onChange={(e) => setPromo((p) => ({ ...p, dismissible: e.target.checked }))}
                  />
                  Customer can dismiss it
                </label>
                <label className="block text-xs text-gray-500">
                  Background
                  <input
                    type="color"
                    className="mt-1 h-10 w-16"
                    value={promo.background_color}
                    onChange={(e) => setPromo((p) => ({ ...p, background_color: e.target.value }))}
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  Text
                  <input
                    type="color"
                    className="mt-1 h-10 w-16"
                    value={promo.text_color}
                    onChange={(e) => setPromo((p) => ({ ...p, text_color: e.target.value }))}
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  Button
                  <input
                    type="color"
                    className="mt-1 h-10 w-16"
                    value={promo.button_color}
                    onChange={(e) => setPromo((p) => ({ ...p, button_color: e.target.value }))}
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  Button text
                  <input
                    type="color"
                    className="mt-1 h-10 w-16"
                    value={promo.button_text_color}
                    onChange={(e) => setPromo((p) => ({ ...p, button_text_color: e.target.value }))}
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  Show from
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={promo.start_at ? promo.start_at.slice(0, 16) : ''}
                    onChange={(e) =>
                      setPromo((p) => ({
                        ...p,
                        start_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                      }))
                    }
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  Show until
                  <input
                    type="datetime-local"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={promo.end_at ? promo.end_at.slice(0, 16) : ''}
                    onChange={(e) =>
                      setPromo((p) => ({
                        ...p,
                        end_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                      }))
                    }
                  />
                </label>
              </div>
            </Card>
          ) : null}

          {tab === 'checkout' ? (
            <div className="space-y-4">
              <Card className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Store URL</h3>
                <div className="flex flex-1 items-center overflow-hidden rounded-lg border border-gray-200">
                  <input
                    type="text"
                    value={subdomain}
                    onChange={(e) =>
                      setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                    }
                    placeholder="my-store"
                    className="flex-1 border-0 bg-white px-3 py-2.5 text-sm focus:outline-none"
                  />
                  <span className="flex-shrink-0 border-l border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
                    {hostSuffix}
                  </span>
                </div>
                {storeUrl ? (
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://${storeUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {storeUrl}
                    </a>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1 text-xs text-gray-500"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 text-green-600" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                ) : null}
                <label className="flex items-center justify-between text-sm">
                  <span>
                    Store is live
                    <span className="block text-xs text-gray-500">
                      {enabled ? 'Customers can visit and order.' : 'Store is offline.'}
                    </span>
                  </span>
                  <Toggle on={enabled} onToggle={() => setEnabled((v) => !v)} />
                </label>
                <label className="block text-xs text-gray-500">
                  Minimum order (₹)
                  <input
                    type="number"
                    min="0"
                    className="mt-1 w-32 rounded-lg border px-3 py-2 text-sm"
                    value={minOrder}
                    onChange={(e) => setMinOrder(e.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allowCod}
                    onChange={(e) => setAllowCod(e.target.checked)}
                  />
                  Allow pay on delivery
                </label>
                <label className="block text-xs text-gray-500">
                  Delivery partner
                  <select
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={deliveryProvider}
                    onChange={(e) => setDeliveryProvider(e.target.value)}
                  >
                    <option value="self">Self (own staff)</option>
                    <option value="shiprocket">Shiprocket</option>
                  </select>
                </label>
                {deliveryProvider === 'shiprocket' ? (
                  <div className="space-y-2">
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      placeholder="Shiprocket email"
                      value={shipEmail}
                      onChange={(e) => setShipEmail(e.target.value)}
                    />
                    <input
                      type="password"
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      placeholder="API password (leave blank to keep)"
                      value={shipPassword}
                      onChange={(e) => setShipPassword(e.target.value)}
                    />
                  </div>
                ) : null}
              </Card>
              <Card className="p-5">
                {business?.id ? <StoreCouponManager businessId={business.id} /> : null}
              </Card>
              <Card className="p-5">
                <h3 className="text-sm font-semibold text-gray-900">Delivery zones</h3>
                <p className="mt-1 mb-4 text-xs text-gray-500">Area and charges for each branch.</p>
                {business?.id ? <DeliveryZoneEditor businessId={business.id} /> : null}
              </Card>
              <Card className="p-5">
                <h3 className="text-sm font-semibold text-gray-900">Products</h3>
                <p className="mt-1 text-xs text-gray-500">
                  In Items, turn on “Show in Store” for each product customers should see.
                </p>
              </Card>
            </div>
          ) : null}

          {tab === 'pages' ? (
            <Card className="p-5 space-y-4">
              <label className="block text-xs text-gray-500">
                About page
                <textarea
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  rows={5}
                  value={aboutMd}
                  onChange={(e) => setAboutMd(e.target.value)}
                />
              </label>
              <label className="block text-xs text-gray-500">
                Contact page
                <textarea
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  rows={5}
                  value={contactMd}
                  onChange={(e) => setContactMd(e.target.value)}
                />
              </label>
            </Card>
          ) : null}
        </div>

        {showPreview ? (
          <aside className="mt-6 hidden xl:block">
            <div className="sticky top-24">
              <StoreLivePreview
                storeName={business?.name ?? 'Your store'}
                tagline={tagline}
                heroUrl={heroUrl}
                theme={previewTheme}
                categories={categories}
              />
            </div>
          </aside>
        ) : null}
      </div>

      <div className="mt-6 xl:hidden">
        {showPreview ? (
          <StoreLivePreview
            storeName={business?.name ?? 'Your store'}
            tagline={tagline}
            heroUrl={heroUrl}
            theme={previewTheme}
            categories={categories}
          />
        ) : null}
      </div>
    </SettingsPageShell>
  );
}
