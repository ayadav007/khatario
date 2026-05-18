'use client';

export const dynamic = 'force-dynamic';

import { PaymentProvidersSettings } from '@/components/settings/PaymentProvidersSettings';
import { ManualPaymentMethodsSettings } from '@/components/settings/manual-payments/ManualPaymentMethodsSettings';
import { useAuth } from '@/contexts/AuthContext';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

export default function PaymentProvidersSettingsPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();

  const [providersLoading, setProvidersLoading] = useState(true);
  const [providers, setProviders] = useState<Array<{ id: string; name?: string; configured: boolean }>>([]);
  const configuredProviders = useMemo(
    () => providers.filter((p) => p.configured),
    [providers]
  );

  const [prefLoading, setPrefLoading] = useState(true);
  const [savingPref, setSavingPref] = useState(false);
  const [defaultProvider, setDefaultProvider] = useState<string>(''); // '' means auto

  useEffect(() => {
    async function load() {
      if (!business?.id || !user?.id) return;
      setProvidersLoading(true);
      setPrefLoading(true);
      try {
        const params = new URLSearchParams({
          business_id: business.id,
          user_id: user.id,
        });
        const [provRes, prefRes] = await Promise.all([
          fetch(`/api/settings/payment-providers?${params.toString()}`, { credentials: 'include' }),
          fetch(`/api/settings/payments?${params.toString()}`, { credentials: 'include' }),
        ]);
        const provJson = await provRes.json();
        const prefJson = await prefRes.json();

        if (provRes.ok) {
          setProviders(provJson.providers || []);
        }
        if (prefRes.ok) {
          setDefaultProvider(prefJson.default_payment_provider || '');
        }
      } catch (e) {
        // Non-fatal; providers UI still works
      } finally {
        setProvidersLoading(false);
        setPrefLoading(false);
      }
    }
    void load();
  }, [business?.id, user?.id]);

  async function saveDefaultProvider() {
    if (!business?.id || !user?.id) return;
    setSavingPref(true);
    try {
      const res = await fetch('/api/settings/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          business_id: business.id,
          user_id: user.id,
          default_payment_provider: defaultProvider || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to save');
      setDefaultProvider(json.default_payment_provider || '');
      toast.success('Saved payment preference');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save payment preference');
    } finally {
      setSavingPref(false);
    }
  }

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Payments</h1>
        <p className="text-sm text-text-secondary mt-1">
          Configure automatic gateways and manual payment methods in one place.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            Automatic Payments (Recommended)
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Automatically confirms payments
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-[240px]">
              <div className="text-sm font-semibold text-text-primary">Preferred provider</div>
              <div className="text-xs text-text-muted mt-0.5">
                Used by WhatsApp payment links when multiple providers are configured.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-10 rounded-md border border-border bg-white px-3 text-sm min-w-[240px]"
                value={defaultProvider}
                disabled={providersLoading || prefLoading || configuredProviders.length === 0}
                onChange={(e) => setDefaultProvider(e.target.value)}
              >
                <option value="">Auto (no preference)</option>
                {configuredProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name ? `${p.name} (${p.id})` : p.id}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                disabled={providersLoading || prefLoading}
                isLoading={savingPref}
                onClick={() => void saveDefaultProvider()}
              >
                Save
              </Button>
            </div>
          </div>
          {configuredProviders.length === 0 && !providersLoading && (
            <div className="text-xs text-text-muted mt-2">
              Configure a payment provider below to enable preference selection.
            </div>
          )}
        </div>

        <PaymentProvidersSettings embedded />
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">
            Manual Payments (Fallback)
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Use when no payment provider is configured
          </p>
        </div>
        <ManualPaymentMethodsSettings businessId={business?.id ?? null} userId={user?.id ?? null} />
      </div>
    </div>
  );
}
