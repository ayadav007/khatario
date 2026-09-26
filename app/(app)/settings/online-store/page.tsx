'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Store, ExternalLink, Loader2, Copy, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DeliveryZoneEditor } from '@/components/store/admin/DeliveryZoneEditor';
import { StoreAppearanceStudio } from '@/components/store/admin/StoreAppearanceStudio';
import { StoreLivePreview } from '@/components/store/admin/StoreLivePreview';
import { StoreCouponManager } from '@/components/store/admin/StoreCouponManager';
import { StoreImageField } from '@/components/store/admin/StoreImageField';
import { storeHostSuffix } from '@/lib/store/subdomain';
import {
  DEFAULT_STORE_PROMO,
  nextPromoSheetVersion,
  sanitizeStorePromoSheet,
  type StorePromoSheetConfig,
} from '@/lib/store/promo-sheet';
import {
  DEFAULT_STORE_THEME,
  sanitizeStoreTheme,
  type StoreTheme,
} from '@/lib/store/store-theme';
import clsx from 'clsx';

type EditorTab = 'appearance' | 'promo' | 'setup' | 'pages';

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
  { id: 'appearance', label: 'Appearance' },
  { id: 'promo', label: 'Promo' },
  { id: 'setup', label: 'Store setup' },
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
  const [tab, setTab] = useState<EditorTab>('appearance');
  const [showPreview, setShowPreview] = useState(true);

  const [subdomain, setSubdomain] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [tagline, setTagline] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [heroUrl, setHeroUrl] = useState('');
  const [aboutMd, setAboutMd] = useState('');
  const [contactMd, setContactMd] = useState('');
  const [privacyMd, setPrivacyMd] = useState('');
  const [refundMd, setRefundMd] = useState('');
  const [termsMd, setTermsMd] = useState('');
  const [allowCod, setAllowCod] = useState(true);
  const [deliveryProvider, setDeliveryProvider] = useState('self');
  const [hideBadge, setHideBadge] = useState(false);
  const [shipEmail, setShipEmail] = useState('');
  const [shipPassword, setShipPassword] = useState('');
  const [promo, setPromo] = useState<StorePromoSheetConfig>(DEFAULT_STORE_PROMO);
  const [savedPromo, setSavedPromo] = useState<StorePromoSheetConfig>(DEFAULT_STORE_PROMO);
  const [theme, setTheme] = useState<StoreTheme>(DEFAULT_STORE_THEME);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
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
        setPrivacyMd((data as { store_privacy_md?: string }).store_privacy_md ?? '');
        setRefundMd((data as { store_refund_md?: string }).store_refund_md ?? '');
        setTermsMd((data as { store_terms_md?: string }).store_terms_md ?? '');
        setAllowCod(data.store_allow_cod !== false);
        setDeliveryProvider(data.store_delivery_provider ?? 'self');
        const nextTheme = sanitizeStoreTheme(data.store_theme);
        if (nextTheme.hero_slides.length === 0 && data.store_hero_image_url) {
          nextTheme.hero_slides = [
            {
              image_url: data.store_hero_image_url,
              title: data.store_tagline ?? '',
              subtitle: nextTheme.hero_subtitle,
              viewport: 'both',
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
      } else {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === 'string' ? data.error : 'Failed to load settings');
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
          store_privacy_md: privacyMd || null,
          store_refund_md: refundMd || null,
          store_terms_md: termsMd || null,
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
    privacyMd,
    refundMd,
    termsMd,
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

  const storefrontBase = useCallback(() => {
    if (!storeUrl || typeof window === 'undefined') return null;
    const proto = window.location.protocol;
    const port = hostSuffix === '.localhost' && window.location.port ? `:${window.location.port}` : '';
    return `${proto}//${storeUrl}${port}`;
  }, [storeUrl, hostSuffix]);

  useEffect(() => {
    if (loading) return;
    const base = storefrontBase();
    if (!base) return;
    const id = window.setTimeout(() => {
      setPreviewSrc((prev) => prev ?? `${base}/`);
    }, 800);
    return () => window.clearTimeout(id);
  }, [loading, storefrontBase]);

  const handleUpdatePreview = useCallback(async () => {
    const base = storefrontBase();
    if (!base) {
      setError('Set a store URL under Store setup first.');
      return;
    }
    setPreviewBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/online-store/preview-draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business?.id,
          theme: sanitizeStoreTheme({
            ...theme,
            logo_url: theme.logo_url || businessLogo,
          }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.token !== 'string') {
        setError(typeof data.error === 'string' ? data.error : 'Could not update preview');
        return;
      }
      setPreviewSrc(`${base}/?td=${encodeURIComponent(data.token)}`);
    } catch {
      setError('Could not update preview');
    } finally {
      setPreviewBusy(false);
    }
  }, [storefrontBase, business?.id, theme, businessLogo]);

  const sectionsSig = theme.homepage_sections.map((s) => `${s.id}:${s.enabled ? 1 : 0}`).join('|');
  const previewContentSig = [
    sectionsSig,
    theme.category_style,
    JSON.stringify(theme.category_images),
    JSON.stringify(theme.overlay_bands),
  ].join('|');
  const skipSectionPreview = useRef(true);
  useEffect(() => {
    if (loading) return;
    if (skipSectionPreview.current) {
      skipSectionPreview.current = false;
      return;
    }
    const t = window.setTimeout(() => void handleUpdatePreview(), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewContentSig only
  }, [previewContentSig, loading]);

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
      description="Customize the store, then Update preview. Save publishes the live storefront."
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

      <div className={clsx('gap-6', showPreview && 'xl:grid xl:grid-cols-[minmax(0,1fr)_440px]')}>
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

          {tab === 'appearance' ? (
            <StoreAppearanceStudio
              theme={theme}
              setTheme={setTheme}
              hideBadge={hideBadge}
              setHideBadge={setHideBadge}
              tagline={tagline}
              setTagline={setTagline}
              categories={categories}
              hostSuffix={hostSuffix}
              storeUrl={storeUrl}
              onUpdate={() => void handleUpdatePreview()}
              updating={previewBusy}
            />
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
                    placeholder="Shop now"
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  When they tap it
                  <select
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={
                      promo.cta_action === 'shop' ||
                      promo.cta_action === 'whatsapp' ||
                      promo.cta_action === 'url' ||
                      promo.cta_action === 'none'
                        ? promo.cta_action
                        : 'shop'
                    }
                    onChange={(e) =>
                      setPromo((p) => ({
                        ...p,
                        cta_action: e.target.value as StorePromoSheetConfig['cta_action'],
                      }))
                    }
                  >
                    <option value="shop">Shop the store (catalog)</option>
                    <option value="whatsapp">Message on WhatsApp</option>
                    <option value="url">Open a product or page</option>
                    <option value="none">No button</option>
                  </select>
                  <span className="mt-1 block text-[11px] text-gray-400">
                    {promo.cta_action === 'shop'
                      ? 'Closes the promo and scrolls to products. A coupon code is saved for checkout.'
                      : promo.cta_action === 'whatsapp'
                        ? 'Opens a WhatsApp chat with this store’s phone number.'
                        : promo.cta_action === 'url'
                          ? 'Use a product link like /products/… or a full https URL.'
                          : 'Poster only. Customers close it with the X.'}
                  </span>
                </label>
                {promo.cta_action === 'url' ? (
                  <label className="block text-xs text-gray-500 sm:col-span-2">
                    Custom link
                    <input
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                      value={promo.cta_url}
                      onChange={(e) => setPromo((p) => ({ ...p, cta_url: e.target.value }))}
                      placeholder="/products/… or https://"
                    />
                  </label>
                ) : null}
                <label className="block text-xs text-gray-500">
                  Coupon to apply at checkout
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm uppercase"
                    value={promo.coupon_code}
                    onChange={(e) =>
                      setPromo((p) => ({ ...p, coupon_code: e.target.value.toUpperCase() }))
                    }
                    placeholder="Optional"
                  />
                  <span className="mt-1 block text-[11px] text-gray-400">
                    Saved when they tap the button. It is applied when they actually check out — not by opening an empty cart.
                  </span>
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

          {tab === 'setup' ? (
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
              <label className="block text-xs text-gray-500">
                Privacy policy
                <textarea className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={4} value={privacyMd} onChange={(e) => setPrivacyMd(e.target.value)} />
              </label>
              <label className="block text-xs text-gray-500">
                Refund policy
                <textarea className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={4} value={refundMd} onChange={(e) => setRefundMd(e.target.value)} />
              </label>
              <label className="block text-xs text-gray-500">
                Terms and conditions
                <textarea className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={4} value={termsMd} onChange={(e) => setTermsMd(e.target.value)} />
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
                iframeSrc={previewSrc}
                updating={previewBusy}
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
            iframeSrc={previewSrc}
            updating={previewBusy}
          />
        ) : null}
      </div>
    </SettingsPageShell>
  );
}
