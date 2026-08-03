'use client';

import { useState, useEffect, useCallback } from 'react';
import { Store, ExternalLink, Loader2, Copy, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DeliveryZoneEditor } from '@/components/store/admin/DeliveryZoneEditor';

interface StoreSettings {
  store_subdomain: string | null;
  store_enabled: boolean;
  store_tagline: string | null;
  store_hero_image_url: string | null;
  store_min_order_amount: number;
}

export default function OnlineStoreSettingsPage() {
  const { business, user } = useAuth();
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  const [subdomain, setSubdomain] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [tagline, setTagline] = useState('');
  const [minOrder, setMinOrder] = useState('');

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
  }, [business?.id, subdomain, enabled, tagline, minOrder, fetchSettings]);

  const storeUrl = subdomain
    ? `${subdomain}.khatario.com`
    : null;

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
                .khatario.com
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
