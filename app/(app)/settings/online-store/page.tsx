'use client';

import { useState, useEffect, useCallback } from 'react';
import { Store, ExternalLink, Loader2, Copy, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DeliveryZoneEditor } from '@/components/store/admin/DeliveryZoneEditor';
import { storeHostSuffix } from '@/lib/store/subdomain';
import {
  DEFAULT_STORE_PROMO,
  sanitizeStorePromoSheet,
  type StorePromoSheetConfig,
} from '@/lib/store/promo-sheet';

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
  store_theme?: { accent?: string } | null;
  store_hide_khatario_badge?: boolean;
  store_shiprocket_email?: string | null;
  shiprocket_configured?: boolean;
  store_promo_sheet?: StorePromoSheetConfig | null;
}

export default function OnlineStoreSettingsPage() {
  const { business, user } = useAuth();
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hostSuffix, setHostSuffix] = useState('.khatario.com');

  const [subdomain, setSubdomain] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [tagline, setTagline] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [heroUrl, setHeroUrl] = useState('');
  const [aboutMd, setAboutMd] = useState('');
  const [contactMd, setContactMd] = useState('');
  const [allowCod, setAllowCod] = useState(true);
  const [deliveryProvider, setDeliveryProvider] = useState('self');
  const [accent, setAccent] = useState('#16a34a');
  const [hideBadge, setHideBadge] = useState(false);
  const [shipEmail, setShipEmail] = useState('');
  const [shipPassword, setShipPassword] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponValue, setCouponValue] = useState('10');
  const [promo, setPromo] = useState<StorePromoSheetConfig>(DEFAULT_STORE_PROMO);

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
        setSettings(data);
        setSubdomain(data.store_subdomain ?? '');
        setEnabled(data.store_enabled);
        setTagline(data.store_tagline ?? '');
        setMinOrder(data.store_min_order_amount ? String(data.store_min_order_amount) : '');
        setHeroUrl(data.store_hero_image_url ?? '');
        setAboutMd(data.store_about_md ?? '');
        setContactMd(data.store_contact_md ?? '');
        setAllowCod(data.store_allow_cod !== false);
        setDeliveryProvider(data.store_delivery_provider ?? 'self');
        setAccent(data.store_theme?.accent || '#16a34a');
        setHideBadge(!!data.store_hide_khatario_badge);
        setShipEmail(data.store_shiprocket_email ?? '');
        setPromo(sanitizeStorePromoSheet(data.store_promo_sheet));
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
          store_hero_image_url: heroUrl.trim() || null,
          store_about_md: aboutMd || null,
          store_contact_md: contactMd || null,
          store_allow_cod: allowCod,
          store_delivery_provider: deliveryProvider,
          store_theme: { accent },
          store_hide_khatario_badge: hideBadge,
          store_shiprocket_email: shipEmail || null,
          store_shiprocket_password: shipPassword || undefined,
          store_promo_sheet: { ...promo, version: String(Date.now()) },
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
  }, [business?.id, subdomain, enabled, tagline, minOrder, heroUrl, aboutMd, contactMd, allowCod, deliveryProvider, accent, hideBadge, shipEmail, shipPassword, promo, fetchSettings]);

  const storeUrl = subdomain ? `${subdomain}${hostSuffix}` : null;

  const handleCopy = useCallback(() => {
    if (storeUrl) {
      void navigator.clipboard.writeText(`https://${storeUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [storeUrl]);

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
      title="Online Store"
      description="Set up your public storefront where customers can browse and order products."
      icon={Store}
      actions={
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
        </Button>
      }
    >
      {error ? (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          Settings saved successfully
        </div>
      ) : null}

      <div className="space-y-6">
        {/* Store URL */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900">Store URL</h3>
          <p className="mt-1 text-xs text-gray-500">
            Your unique store address. Customers will visit this URL to shop.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex flex-1 items-center overflow-hidden rounded-lg border border-gray-200">
              <input
                type="text"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="my-store"
                className="flex-1 border-0 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
              />
              <span className="flex-shrink-0 border-l border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
                {hostSuffix}
              </span>
            </div>
          </div>
          {storeUrl ? (
            <div className="mt-2 flex items-center gap-2">
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
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-green-600" />
                    <span className="text-green-600">Copied</span>
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
        </Card>

        {/* Enable/Disable */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Store Status</h3>
              <p className="mt-1 text-xs text-gray-500">
                {enabled
                  ? 'Your store is live and visible to customers.'
                  : 'Your store is currently offline. Enable it to start taking orders.'}
              </p>
            </div>
            <button
              onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                enabled ? 'bg-green-500' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </Card>

        {/* Tagline */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900">Store Tagline</h3>
          <p className="mt-1 text-xs text-gray-500">
            A short description shown below your store name.
          </p>
          <input
            type="text"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="e.g. Fresh groceries delivered to your door"
            maxLength={120}
            className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
          />
        </Card>

        {/* Minimum order */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900">Minimum Order Amount</h3>
          <p className="mt-1 text-xs text-gray-500">
            Set a minimum cart value for checkout. Set to 0 for no minimum.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-gray-500">&#x20B9;</span>
            <input
              type="number"
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
              placeholder="0"
              min="0"
              step="1"
              className="w-32 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-300"
            />
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900">Hero image URL</h3>
          <input
            className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
            value={heroUrl}
            onChange={(e) => setHeroUrl(e.target.value)}
            placeholder="https://..."
          />
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900">Checkout</h3>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowCod} onChange={(e) => setAllowCod(e.target.checked)} />
            Allow pay on delivery
          </label>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900">Delivery partner</h3>
          <select
            className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
            value={deliveryProvider}
            onChange={(e) => setDeliveryProvider(e.target.value)}
          >
            <option value="self">Self (own staff / your rate card)</option>
            <option value="shiprocket">Shiprocket</option>
          </select>
          {deliveryProvider === 'shiprocket' ? (
            <div className="mt-3 space-y-2">
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
          <h3 className="text-sm font-semibold text-gray-900">Branding</h3>
          <label className="mt-3 block text-xs text-gray-500">Accent colour</label>
          <input type="color" className="mt-1 h-10 w-16" value={accent} onChange={(e) => setAccent(e.target.value)} />
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hideBadge} onChange={(e) => setHideBadge(e.target.checked)} />
            Hide “Powered by Khatario”
          </label>
          <label className="mt-3 block text-xs text-gray-500">About page</label>
          <textarea className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={3} value={aboutMd} onChange={(e) => setAboutMd(e.target.value)} />
          <label className="mt-3 block text-xs text-gray-500">Contact page</label>
          <textarea className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={3} value={contactMd} onChange={(e) => setContactMd(e.target.value)} />
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Opening promo sheet</h3>
              <p className="mt-1 text-xs text-gray-500">
                Slides up from the bottom when a customer opens your store. Leave it off if you do not want a popup.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPromo((p) => ({ ...p, enabled: !p.enabled }))}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent ${
                promo.enabled ? 'bg-green-500' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ${
                  promo.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-gray-500 sm:col-span-2">
              Title
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
                value={promo.title}
                maxLength={80}
                onChange={(e) => setPromo((p) => ({ ...p, title: e.target.value }))}
                placeholder="Festival sale"
              />
            </label>
            <label className="block text-xs text-gray-500 sm:col-span-2">
              Message
              <textarea
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
                rows={3}
                maxLength={400}
                value={promo.body}
                onChange={(e) => setPromo((p) => ({ ...p, body: e.target.value }))}
                placeholder="Free delivery this weekend"
              />
            </label>
            <label className="block text-xs text-gray-500 sm:col-span-2">
              Image URL
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
                value={promo.image_url}
                onChange={(e) => setPromo((p) => ({ ...p, image_url: e.target.value }))}
                placeholder="https://..."
              />
            </label>
            <label className="block text-xs text-gray-500">
              Button text
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
                value={promo.cta_label}
                onChange={(e) => setPromo((p) => ({ ...p, cta_label: e.target.value }))}
              />
            </label>
            <label className="block text-xs text-gray-500">
              Button opens
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
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
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
                  value={promo.cta_url}
                  onChange={(e) => setPromo((p) => ({ ...p, cta_url: e.target.value }))}
                  placeholder="/products/... or https://"
                />
              </label>
            ) : null}
            <label className="block text-xs text-gray-500">
              Coupon to apply
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
                value={promo.coupon_code}
                onChange={(e) =>
                  setPromo((p) => ({ ...p, coupon_code: e.target.value.toUpperCase() }))
                }
                placeholder="Optional"
              />
            </label>
            <label className="block text-xs text-gray-500">
              How often
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
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
              Delay (ms)
              <input
                type="number"
                min={0}
                max={8000}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
                value={promo.delay_ms}
                onChange={(e) =>
                  setPromo((p) => ({ ...p, delay_ms: Number(e.target.value) || 0 }))
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={promo.dismissible}
                onChange={(e) => setPromo((p) => ({ ...p, dismissible: e.target.checked }))}
              />
              Customer can swipe / tap away
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
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
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
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
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

        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900">Coupon</h3>
          <div className="mt-3 flex gap-2">
            <input className="flex-1 rounded-lg border px-3 py-2 text-sm" placeholder="SAVE10" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} />
            <input className="w-20 rounded-lg border px-3 py-2 text-sm" value={couponValue} onChange={(e) => setCouponValue(e.target.value)} />
            <Button
              type="button"
              onClick={async () => {
                if (!business?.id || !couponCode.trim()) return;
                await fetch('/api/settings/online-store/coupons', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    business_id: business.id,
                    code: couponCode,
                    discount_type: 'percent',
                    discount_value: parseFloat(couponValue) || 0,
                  }),
                });
                setCouponCode('');
              }}
            >
              Add %
            </Button>
          </div>
        </Card>

        {/* Delivery Zones */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900">Delivery Zones</h3>
          <p className="mt-1 mb-4 text-xs text-gray-500">
            Configure delivery area and charges for each branch.
          </p>
          {business?.id ? (
            <DeliveryZoneEditor businessId={business.id} />
          ) : null}
        </Card>

        {/* Info about products */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900">Store Products</h3>
          <p className="mt-1 text-xs text-gray-500">
            To show products in your store, go to your Items list and enable &quot;Show in Store&quot;
            for each product you want visible to customers.
          </p>
        </Card>
      </div>
    </SettingsPageShell>
  );
}
