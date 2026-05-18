'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Loader2, Wallet } from 'lucide-react';
import {
  PaymentProviderCard,
  type PaymentProviderStatusRow,
} from '@/components/settings/PaymentProviderCard';
import { ProviderSelector } from '@/components/settings/ProviderSelector';
import { getSupportedPaymentProviderCatalog } from '@/lib/payment-providers-catalog';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

export function PaymentProvidersSettings(props?: { embedded?: boolean }) {
  const embedded = props?.embedded === true;
  const { business, user } = useAuth();
  const toast = useToastContext();
  const catalog = useMemo(
    () => getSupportedPaymentProviderCatalog(),
    []
  );
  const [providers, setProviders] = useState<PaymentProviderStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');

  useEffect(() => {
    setOrigin(typeof window !== 'undefined' ? window.location.origin : '');
  }, []);

  const loadProviders = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user.id,
      });
      const res = await fetch(
        `/api/settings/payment-providers?${params.toString()}`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not load payment providers');
        setProviders([]);
        return;
      }
      setProviders((data.providers || []) as PaymentProviderStatusRow[]);
    } catch {
      toast.error('Could not load payment providers');
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, toast]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    const firstId = catalog[0]?.id ?? '';
    setSelectedProviderId((prev) => {
      if (prev && catalog.some((d) => d.id === prev)) return prev;
      return firstId;
    });
  }, [catalog]);

  const selectedDefinition = useMemo(
    () => catalog.find((d) => d.id === selectedProviderId) ?? catalog[0],
    [catalog, selectedProviderId]
  );

  const content = loading ? (
    <div className="flex justify-center py-16">
      <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
    </div>
  ) : (
    <div className="space-y-8">
      <ProviderSelector
        definitions={catalog}
        statuses={providers}
        selectedProviderId={selectedProviderId}
        onSelect={setSelectedProviderId}
      />

      {selectedDefinition ? (
        <div
          role="tabpanel"
          id={`provider-panel-${selectedDefinition.id}`}
          aria-labelledby={`provider-tab-${selectedDefinition.id}`}
        >
          <PaymentProviderCard
            key={selectedDefinition.id}
            definition={selectedDefinition}
            status={providers.find((p) => p.id === selectedDefinition.id)}
            businessId={business?.id ?? ''}
            userId={user?.id ?? ''}
            origin={origin}
            isSaving={savingProviderId === selectedDefinition.id}
            onSavingChange={(saving) =>
              setSavingProviderId(saving ? selectedDefinition.id : null)
            }
            onSaved={loadProviders}
          />
        </div>
      ) : null}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/settings" className="hover:text-primary-600 transition">
          Settings
        </Link>
        <ChevronRight className="w-4 h-4" />
        <Link
          href="/settings/integrations"
          className="hover:text-primary-600 transition"
        >
          Integrations
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-text-primary font-medium">Payment providers</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-gray-100 p-3 dark:bg-slate-800">
          <Wallet className="h-6 w-6 text-gray-700 dark:text-slate-200" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Payment providers
          </h1>
          <p className="text-sm text-text-secondary">
            Connect payment gateways for online collections (UPI collect, webhooks).
          </p>
        </div>
      </div>

      {content}
    </div>
  );
}
