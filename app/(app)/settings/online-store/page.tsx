'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Store,
  ExternalLink,
  Loader2,
  Copy,
  Check,
  Sparkles,
  Inbox,
  Star,
  ShoppingCart,
  Palette,
  Settings2,
  Brush,
  Megaphone,
  FileText,
  Truck,
  BadgeCheck,
  AlertCircle,
  CircleDot,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { SettingsFloatingSaveBar } from '@/components/settings/SettingsFloatingSaveBar';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DeliveryZoneEditor } from '@/components/store/admin/DeliveryZoneEditor';
import { StoreDesignCard } from '@/components/store/admin/StoreDesignCard';
import { StoreLivePreview } from '@/components/store/admin/StoreLivePreview';
import { StoreCouponManager } from '@/components/store/admin/StoreCouponManager';
import {
  StoreKhataSettings,
  type StoreKhataCounts,
  type StoreKhataRules,
} from '@/components/store/admin/StoreKhataSettings';
import {
  AffixInput,
  SetupBlock,
  SetupGroup,
  SetupRow,
  SetupSwitch,
  setupSelectClass,
} from '@/components/store/admin/StoreSetupLayout';
import { StoreImageField } from '@/components/store/admin/StoreImageField';
import {
  StoreHoursCard,
  storeHoursDraft,
  storeHoursFromDraft,
  type StoreHoursDraft,
} from '@/components/store/admin/StoreHoursCard';
import type { StoreHours } from '@/lib/store/store-hours';
import { storeHostSuffix } from '@/lib/store/subdomain';
import { editorPath, openWorkingDraft } from '@/components/store/studio2/api';
import { pendingBadgeText } from '@/lib/store/review-admin-helpers';
import {
  DEFAULT_STORE_PROMO,
  nextPromoSheetVersion,
  sanitizeStorePromoSheet,
  type StorePromoSheetConfig,
} from '@/lib/store/promo-sheet';
import clsx from 'clsx';

type EditorTab = 'appearance' | 'promo' | 'setup' | 'pages';

interface StoreSettings {
  store_subdomain: string | null;
  store_enabled: boolean;
  store_tagline: string | null;
  store_hero_image_url: string | null;
  store_min_order_amount: number;
  store_hours?: StoreHours | null;
  store_allow_cod?: boolean;
  store_return_window_days?: number;
  store_delivery_provider?: string;
  store_about_md?: string | null;
  store_contact_md?: string | null;
  store_hide_khatario_badge?: boolean;
  store_shiprocket_email?: string | null;
  shiprocket_webhook_configured?: boolean;
  store_promo_sheet?: StorePromoSheetConfig | null;
  store_cart_reminder_enabled?: boolean;
  store_cart_reminder_hours?: number;
  store_engine?: boolean;
  store_product_count?: number | null;
}

const TABS: Array<{ id: EditorTab; label: string; icon: LucideIcon }> = [
  { id: 'setup', label: 'Store setup', icon: Settings2 },
  { id: 'appearance', label: 'Appearance', icon: Brush },
  { id: 'promo', label: 'Promo', icon: Megaphone },
  { id: 'pages', label: 'Pages', icon: FileText },
];

/** The phone preview and "Edit store design" only matter on the tabs that change how the store looks. */
const DESIGN_TABS: EditorTab[] = ['appearance', 'promo'];

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateWebhookToken(length = 40): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('');
}

export default function OnlineStoreSettingsPage() {
  const { business, user } = useAuth();
  const router = useRouter();
  const [storeEngine, setStoreEngine] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [pendingReviews, setPendingReviews] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hostSuffix, setHostSuffix] = useState('.khatario.com');
  const [tab, setTab] = useState<EditorTab>('setup');
  const [showPreview, setShowPreview] = useState(true);

  const [subdomain, setSubdomain] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [tagline, setTagline] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [hours, setHours] = useState<StoreHoursDraft>(() => storeHoursDraft(null));
  const [heroUrl, setHeroUrl] = useState('');
  const [aboutMd, setAboutMd] = useState('');
  const [contactMd, setContactMd] = useState('');
  const [privacyMd, setPrivacyMd] = useState('');
  const [refundMd, setRefundMd] = useState('');
  const [termsMd, setTermsMd] = useState('');
  const [allowCod, setAllowCod] = useState(true);
  const [returnDays, setReturnDays] = useState('7');
  const [deliveryProvider, setDeliveryProvider] = useState('self');
  const [hideBadge, setHideBadge] = useState(false);
  const [cartReminderOn, setCartReminderOn] = useState(false);
  const [cartReminderHours, setCartReminderHours] = useState('3');
  const [shipEmail, setShipEmail] = useState('');
  const [shipPassword, setShipPassword] = useState('');
  const [shipWebhookToken, setShipWebhookToken] = useState('');
  const [shipWebhookConfigured, setShipWebhookConfigured] = useState(false);
  const [promo, setPromo] = useState<StorePromoSheetConfig>(DEFAULT_STORE_PROMO);
  const [savedPromo, setSavedPromo] = useState<StorePromoSheetConfig>(DEFAULT_STORE_PROMO);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [activeZones, setActiveZones] = useState<number | null>(null);
  const [khata, setKhata] = useState<StoreKhataRules | null>(null);
  const [savedKhata, setSavedKhata] = useState<StoreKhataRules | null>(null);
  const [khataCounts, setKhataCounts] = useState<StoreKhataCounts>({ open: 0, requests: 0 });
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const takeBaseline = useRef(false);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;
    fetch(`/api/settings/online-store/reviews?business_id=${business.id}&status=pending`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.reviews)) setPendingReviews(data.reviews.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [business?.id]);

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
        setHours(storeHoursDraft(data.store_hours));
        setHeroUrl(data.store_hero_image_url ?? '');
        setAboutMd(data.store_about_md ?? '');
        setContactMd(data.store_contact_md ?? '');
        setPrivacyMd((data as { store_privacy_md?: string }).store_privacy_md ?? '');
        setRefundMd((data as { store_refund_md?: string }).store_refund_md ?? '');
        setTermsMd((data as { store_terms_md?: string }).store_terms_md ?? '');
        setAllowCod(data.store_allow_cod !== false);
        setReturnDays(String(data.store_return_window_days ?? 7));
        setDeliveryProvider(data.store_delivery_provider ?? 'self');
        setHideBadge(!!data.store_hide_khatario_badge);
        setCartReminderOn(data.store_cart_reminder_enabled === true);
        setCartReminderHours(String(data.store_cart_reminder_hours ?? 3));
        setStoreEngine(data.store_engine === true);
        setShipEmail(data.store_shiprocket_email ?? '');
        setShipWebhookConfigured(!!data.shiprocket_webhook_configured);
        setShipWebhookToken('');
        setShipPassword('');
        setProductCount(typeof data.store_product_count === 'number' ? data.store_product_count : null);
        takeBaseline.current = true;
        setLoadVersion((v) => v + 1);
        const nextPromo = sanitizeStorePromoSheet(data.store_promo_sheet);
        setPromo(nextPromo);
        setSavedPromo(nextPromo);
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

  const fetchKhata = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/khata', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setKhata(data.settings);
      setSavedKhata(data.settings);
      setKhataCounts({ open: data.open_khatas ?? 0, requests: data.khata_requests ?? 0 });
    } catch {
      /* the khata group keeps showing its loading line */
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
    void fetchKhata();
  }, [fetchSettings, fetchKhata]);

  useEffect(() => {
    setHostSuffix(storeHostSuffix(window.location.hostname));
  }, []);

  const openStoreDesignEditor = useCallback(async () => {
    if (!business?.id) return;
    setOpeningEditor(true);
    setError(null);
    try {
      const draft = await openWorkingDraft(business.id);
      router.push(editorPath(draft.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open the store design editor');
      setOpeningEditor(false);
    }
  }, [business?.id, router]);

  /** Everything the Save button writes to store settings, so the save bar can tell when something changed. */
  const snapshot = useMemo(
    () =>
      JSON.stringify([
        subdomain, enabled, tagline, minOrder, heroUrl, aboutMd, contactMd, privacyMd, refundMd, termsMd,
        allowCod, returnDays, deliveryProvider, hideBadge, cartReminderOn, cartReminderHours, shipEmail,
        sanitizeStorePromoSheet(promo), storeHoursFromDraft(hours),
      ]),
    [
      subdomain, enabled, tagline, minOrder, heroUrl, aboutMd, contactMd, privacyMd, refundMd, termsMd,
      allowCod, returnDays, deliveryProvider, hideBadge, cartReminderOn, cartReminderHours, shipEmail, promo,
      hours,
    ],
  );

  useEffect(() => {
    if (!takeBaseline.current) return;
    takeBaseline.current = false;
    setSavedSnapshot(snapshot);
  }, [snapshot, loadVersion]);

  const khataDirty = !!khata && JSON.stringify(khata) !== JSON.stringify(savedKhata);
  const settingsDirty =
    (savedSnapshot !== null && snapshot !== savedSnapshot) || !!shipPassword || !!shipWebhookToken;
  const dirty = settingsDirty || khataDirty;

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
          store_hours: storeHoursFromDraft(hours),
          store_hero_image_url: heroUrl.trim() || null,
          store_about_md: aboutMd || null,
          store_contact_md: contactMd || null,
          store_privacy_md: privacyMd || null,
          store_refund_md: refundMd || null,
          store_terms_md: termsMd || null,
          store_allow_cod: allowCod,
          store_return_window_days: Number(returnDays) || 0,
          store_delivery_provider: deliveryProvider,
          store_hide_khatario_badge: hideBadge,
          store_cart_reminder_enabled: cartReminderOn,
          store_cart_reminder_hours: Math.min(72, Math.max(1, Math.round(Number(cartReminderHours)) || 3)),
          store_shiprocket_email: shipEmail || null,
          store_shiprocket_password: shipPassword || undefined,
          store_shiprocket_webhook_token: shipWebhookToken || undefined,
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

      if (khataDirty && khata) {
        const khataRes = await fetch('/api/settings/khata', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(khata),
        });
        const khataData = await khataRes.json().catch(() => ({}));
        if (!khataRes.ok) {
          setError(khataData.error || 'Store saved, but the khata rules could not be saved');
          void fetchSettings();
          return;
        }
        setKhata(khataData.settings);
        setSavedKhata(khataData.settings);
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
    hours,
    heroUrl,
    aboutMd,
    contactMd,
    privacyMd,
    refundMd,
    termsMd,
    allowCod,
    returnDays,
    deliveryProvider,
    hideBadge,
    cartReminderOn,
    cartReminderHours,
    shipEmail,
    shipPassword,
    shipWebhookToken,
    promo,
    savedPromo,
    khata,
    khataDirty,
    fetchSettings,
  ]);

  const discardChanges = useCallback(() => {
    setError(null);
    setKhata(savedKhata);
    void fetchSettings();
  }, [savedKhata, fetchSettings]);

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

  const switchToNewDesign = useCallback(async () => {
    if (!business?.id) return;
    if (
      !window.confirm(
        'Switch your store to the new design? Your current design is copied into it and shoppers see it straight away. After this you edit your design in the store design editor.',
      )
    ) {
      return;
    }
    setSwitching(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/online-store/switch-engine', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === 'string' ? data.error : 'Could not switch to the new design');
        return;
      }
      setStoreEngine(true);
      const base = storefrontBase();
      if (base) setPreviewSrc(`${base}/?v=${Date.now()}`);
    } catch {
      setError('Could not switch to the new design');
    } finally {
      setSwitching(false);
    }
  }, [business?.id, storefrontBase]);

  const handleCopy = useCallback(() => {
    if (storeUrl) {
      void navigator.clipboard.writeText(`https://${storeUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [storeUrl]);

  const designTab = DESIGN_TABS.includes(tab);
  const previewOn = designTab && showPreview;

  if (loading && savedSnapshot === null) {
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
      description="Set up how your store takes orders, then style it in the store design editor."
      icon={Store}
      actions={
        <div className="flex items-center gap-2">
          {storeEngine && designTab ? (
            <button
              type="button"
              onClick={() => void openStoreDesignEditor()}
              disabled={openingEditor || !business?.id}
              className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {openingEditor ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Edit store design
            </button>
          ) : null}
          {storeEngine ? (
            <Link
              href="/settings/online-store/themes"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Palette className="h-3.5 w-3.5" />
              Themes
            </Link>
          ) : null}
          <Link
            href="/settings/online-store/enquiries"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Inbox className="h-3.5 w-3.5" />
            Enquiries
          </Link>
          <Link
            href="/settings/online-store/reviews"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Star className="h-3.5 w-3.5" />
            Reviews
            {pendingBadgeText(pendingReviews) ? (
              <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white">
                {pendingBadgeText(pendingReviews)}
              </span>
            ) : null}
          </Link>
          <Link
            href="/settings/online-store/abandoned-carts"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            Abandoned carts
          </Link>
          {designTab ? (
            <button
              type="button"
              className="text-xs text-gray-500"
              onClick={() => setShowPreview((v) => !v)}
            >
              {showPreview ? 'Hide preview' : 'Show preview'}
            </button>
          ) : null}
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

      <div className={clsx('gap-6', previewOn && '2xl:grid 2xl:grid-cols-[minmax(0,1fr)_440px]')}>
        <div className={clsx(!designTab && 'mx-auto max-w-3xl')}>
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={clsx(
                  'inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium',
                  tab === t.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50',
                )}
              >
                <t.icon className="h-4 w-4" aria-hidden />
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'appearance' ? (
            <StoreDesignCard
              storeEngine={storeEngine}
              storeHref={storefrontBase()}
              opening={openingEditor}
              switching={switching}
              onEdit={() => void openStoreDesignEditor()}
              onSwitch={() => void switchToNewDesign()}
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
                <SetupSwitch
                  label="Opening promo sheet"
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
              <section
                className="overflow-hidden rounded-xl border border-gray-200 bg-white"
                data-testid="store-setup-status"
              >
                <div className="flex items-center gap-3 px-5 py-4">
                  <div
                    className={clsx(
                      'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
                      enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    <Store className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-gray-900">
                        {enabled ? 'Your store is live' : 'Your store is offline'}
                      </h3>
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                          enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600',
                        )}
                      >
                        <span className={clsx('h-1.5 w-1.5 rounded-full', enabled ? 'bg-green-500' : 'bg-gray-400')} />
                        {enabled ? 'Taking orders' : 'Not taking orders'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {enabled ? 'Customers can visit and order.' : 'Customers see that the store is closed.'}
                    </p>
                  </div>
                  <SetupSwitch label="Store is live" on={enabled} onToggle={() => setEnabled((v) => !v)} />
                </div>
                <div className="border-t border-gray-100 px-5 py-4">
                  <label htmlFor="store-subdomain" className="block text-sm font-medium text-gray-900">
                    Web address
                  </label>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex h-10 flex-1 items-stretch overflow-hidden rounded-lg border border-gray-200 focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
                      <input
                        id="store-subdomain"
                        type="text"
                        value={subdomain}
                        onChange={(e) =>
                          setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                        }
                        placeholder="my-store"
                        className="min-w-0 flex-1 border-0 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-0"
                      />
                      <span className="flex flex-shrink-0 items-center border-l border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">
                        {hostSuffix}
                      </span>
                    </div>
                    {storeUrl ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleCopy}
                          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                        <a
                          href={`https://${storeUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Visit
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-gray-100 px-5 py-3" data-testid="store-setup-checklist">
                  {[
                    {
                      key: 'address',
                      ok: !!subdomain,
                      okText: 'Web address',
                      todo: 'Choose a web address',
                      href: undefined,
                    },
                    {
                      key: 'products',
                      ok: productCount === null || productCount > 0,
                      okText:
                        productCount === null
                          ? 'Products'
                          : `${productCount} product${productCount === 1 ? '' : 's'} in store`,
                      todo: 'No products shown yet · Go to Items',
                      href: '/items',
                    },
                    {
                      key: 'delivery',
                      ok: activeZones === null || activeZones > 0,
                      okText: 'Delivery area',
                      todo: 'Add a delivery area',
                      href: '#store-delivery-areas',
                    },
                  ].map((c) =>
                    c.ok ? (
                      <span
                        key={c.key}
                        className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs text-green-700"
                      >
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                        {c.okText}
                      </span>
                    ) : c.href ? (
                      <Link
                        key={c.key}
                        href={c.href}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100"
                      >
                        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                        {c.todo}
                      </Link>
                    ) : (
                      <span
                        key={c.key}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800"
                      >
                        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                        {c.todo}
                      </span>
                    ),
                  )}
                </div>
              </section>

              <SetupGroup icon={ShoppingCart} title="Orders and payment" testId="store-setup-orders">
                <SetupRow label="Minimum order" hint="Cart total needed before checkout. 0 means no minimum." htmlFor="store-min-order">
                  <AffixInput id="store-min-order" min={0} prefix="₹" value={minOrder} placeholder="0" onChange={setMinOrder} />
                </SetupRow>
                <SetupRow label="Cash on delivery" hint="Shoppers can pay when the order arrives.">
                  <SetupSwitch label="Cash on delivery" on={allowCod} onToggle={() => setAllowCod((v) => !v)} />
                </SetupRow>
                <SetupRow
                  label="Abandoned cart reminder"
                  hint="One reminder per cart, by app notification if they have your app, else WhatsApp."
                >
                  <SetupSwitch
                    label="Abandoned cart reminder"
                    on={cartReminderOn}
                    onToggle={() => setCartReminderOn((v) => !v)}
                  />
                </SetupRow>
                {cartReminderOn ? (
                  <SetupRow label="Send the reminder after" htmlFor="store-cart-hours">
                    <AffixInput
                      id="store-cart-hours"
                      min={1}
                      max={72}
                      suffix="hours"
                      value={cartReminderHours}
                      onChange={setCartReminderHours}
                    />
                  </SetupRow>
                ) : null}
              </SetupGroup>

              <StoreHoursCard value={hours} onChange={setHours} />

              <SetupGroup icon={Truck} title="Delivery and returns" testId="store-setup-delivery">
                <SetupRow label="Delivered by" htmlFor="store-delivery-provider">
                  <select
                    id="store-delivery-provider"
                    className={setupSelectClass}
                    value={deliveryProvider}
                    onChange={(e) => setDeliveryProvider(e.target.value)}
                  >
                    <option value="self">Own staff</option>
                    <option value="shiprocket">Shiprocket</option>
                  </select>
                </SetupRow>
                {deliveryProvider === 'shiprocket' ? (
                  <SetupBlock muted>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs text-gray-500">
                        Shiprocket email
                        <input
                          className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900"
                          value={shipEmail}
                          onChange={(e) => setShipEmail(e.target.value)}
                        />
                      </label>
                      <label className="block text-xs text-gray-500">
                        API password
                        <input
                          type="password"
                          className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900"
                          placeholder="Leave blank to keep"
                          value={shipPassword}
                          onChange={(e) => setShipPassword(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="mt-3 text-xs text-gray-600">
                      <p className="font-medium text-gray-800">Tracking webhook token</p>
                      <p className="mt-1">
                        {shipWebhookConfigured
                          ? 'A token is saved. Generate a new one only if you are replacing it in Shiprocket.'
                          : 'Tracking updates are refused until a token is saved here and in Shiprocket (Settings → API → Webhooks).'}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <input
                          readOnly
                          data-testid="shiprocket-webhook-token"
                          className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 font-mono text-xs"
                          placeholder={shipWebhookConfigured ? 'Saved (hidden)' : 'No token yet'}
                          value={shipWebhookToken}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setShipWebhookToken(generateWebhookToken())}
                        >
                          Generate
                        </Button>
                      </div>
                      {shipWebhookToken ? (
                        <p className="mt-2 text-amber-700">
                          Copy this token into Shiprocket, then save. It is not shown again.
                        </p>
                      ) : null}
                    </div>
                  </SetupBlock>
                ) : null}
                <SetupRow
                  label="Return window"
                  hint="Days after delivery a buyer can ask for a return from their account. 0 turns online returns off."
                  htmlFor="store-return-days"
                >
                  <AffixInput
                    id="store-return-days"
                    min={0}
                    max={90}
                    suffix="days"
                    value={returnDays}
                    onChange={setReturnDays}
                  />
                </SetupRow>
                <div id="store-delivery-areas" className="scroll-mt-24">
                  <SetupBlock>
                    <p className="text-sm font-medium text-gray-900">Delivery areas</p>
                    <p className="mt-0.5 mb-3 text-xs text-gray-500">
                      Area and charges for each branch. Each branch saves with its own Save.
                    </p>
                    {business?.id ? (
                      <DeliveryZoneEditor businessId={business.id} onActiveZonesChange={setActiveZones} />
                    ) : null}
                  </SetupBlock>
                </div>
              </SetupGroup>

              {business?.id ? <StoreCouponManager businessId={business.id} /> : null}

              <StoreKhataSettings value={khata} counts={khataCounts} onChange={setKhata} />

              <SetupGroup icon={Sparkles} title="Branding" testId="store-setup-branding">
                <SetupRow label="Hide “Powered by Khatario”" hint="Removes the Khatario line from your store's footer.">
                  <SetupSwitch
                    label="Hide Powered by Khatario"
                    on={hideBadge}
                    onToggle={() => setHideBadge((v) => !v)}
                  />
                </SetupRow>
              </SetupGroup>
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

        {previewOn ? (
          <aside className="mt-6 hidden 2xl:block">
            <div className="sticky top-24">
              <StoreLivePreview iframeSrc={previewSrc} />
            </div>
          </aside>
        ) : null}
      </div>

      <div className="mt-6 2xl:hidden">
        {previewOn ? (
          <StoreLivePreview iframeSrc={previewSrc} />
        ) : null}
      </div>

      {dirty || saving ? (
        <SettingsFloatingSaveBar align="between">
          <span className="flex min-w-0 items-center gap-2 text-sm text-text-secondary" data-testid="store-save-bar">
            <CircleDot className="h-4 w-4 flex-shrink-0 text-amber-500" aria-hidden />
            {saving ? 'Saving your changes' : 'You have unsaved changes'}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={discardChanges} disabled={saving}>
              Discard
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
            </Button>
          </div>
        </SettingsFloatingSaveBar>
      ) : null}
    </SettingsPageShell>
  );
}
