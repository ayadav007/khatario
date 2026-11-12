'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Truck, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { PluginSettingsForm } from '@/components/settings/integrations/PluginSettingsForm';
import { useAuth } from '@/contexts/AuthContext';
import { useCapabilityCheck } from '@/hooks/useCapability';
import type { IntegrationCatalogEntry, IntegrationPlugin } from '@/lib/integrations/catalog';
import type { ConnectionView } from '@/lib/integrations/service';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'setup', label: 'Setup' },
  { key: 'faq', label: 'FAQ' },
  { key: 'settings', label: 'Settings' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const ICONS: Partial<Record<IntegrationCatalogEntry['icon'], LucideIcon>> = { Truck };

export function PluginPage({ entry }: { entry: IntegrationCatalogEntry & { plugin: IntegrationPlugin } }) {
  const { business } = useAuth();
  const { hasCapability } = useCapabilityCheck();
  const canEdit = hasCapability('settings', 'update');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : 'overview';

  const [connection, setConnection] = useState<ConnectionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const businessId = business?.id;
  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(entry.id)}?business_id=${businessId}`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(typeof data.error === 'string' ? data.error : 'Could not load this connection.');
        return;
      }
      setConnection((data.connection as ConnectionView) ?? null);
    } catch {
      setLoadError('Could not load this connection.');
    } finally {
      setLoading(false);
    }
  }, [businessId, entry.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const goTab = (key: TabKey) => router.replace(`${pathname}?tab=${key}`, { scroll: false });

  const disconnect = async () => {
    if (!businessId) return;
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(entry.id)}?business_id=${businessId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDisconnectError(typeof data.error === 'string' ? data.error : 'Could not disconnect. Try again.');
        return;
      }
      setConfirming(false);
      await load();
    } catch {
      setDisconnectError('Could not disconnect. Try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = Boolean(connection?.connected);
  const Icon = ICONS[entry.icon] ?? Truck;
  const { plugin } = entry;

  // Spec 8.2: a user who cannot update settings gets neither Connect nor Disconnect.
  const actions = !canEdit ? null : connected ? (
    <Button variant="secondary" onClick={() => setConfirming(true)}>Disconnect</Button>
  ) : (
    <Button onClick={() => goTab('settings')} disabled={loading}>Connect</Button>
  );
  const tabId = (key: TabKey) => `plugin-${entry.id}-tab-${key}`;
  const panelId = (key: TabKey) => `plugin-${entry.id}-panel-${key}`;
  // Every panel stays mounted and inactive ones are hidden, so a typed password or a generated but
  // unsaved webhook token in the Settings form survives a switch to another tab and back.
  const panelProps = (key: TabKey) => ({
    role: 'tabpanel' as const,
    id: panelId(key),
    'aria-labelledby': tabId(key),
    hidden: tab !== key,
  });

  return (
    <SettingsPageShell title={entry.title} description={entry.shortDescription} icon={Icon} actions={actions} width="form">
      {connected && (
        <div>
          <span className="text-sm font-medium px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
            Connected
          </span>
        </div>
      )}

      {confirming && canEdit && (
        <div role="alertdialog" aria-label={`Disconnect ${entry.title}`} className="rounded-xl border border-border bg-card p-5 space-y-3">
          <p className="text-base text-text-primary">
            Disconnect {entry.title}? Booking, labels and tracking updates stop until you connect again.
          </p>
          {disconnectError && <p role="alert" className="text-sm text-error">{disconnectError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={disconnect} isLoading={disconnecting} disabled={disconnecting}>
              Disconnect
            </Button>
            <Button variant="secondary" onClick={() => { setConfirming(false); setDisconnectError(null); }} disabled={disconnecting}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={tabId(t.key)}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            aria-controls={panelId(t.key)}
            onClick={() => goTab(t.key)}
            className={clsx(
              'px-4 py-2.5 text-base font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
              tab === t.key
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Panel wrappers carry no display class, so the hidden attribute is never overridden. */}
      <div {...panelProps('overview')}>
        <div className="space-y-4">
          {plugin.overview.map((p, i) => (
            <p key={i} className="text-base text-text-primary leading-relaxed">{p}</p>
          ))}
        </div>
      </div>
      <div {...panelProps('setup')}>
        <ol className="list-decimal pl-6 space-y-3 text-base text-text-primary leading-relaxed">
          {plugin.setupSteps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </div>
      <div {...panelProps('faq')}>
        <dl className="space-y-5">
          {plugin.faq.map((f, i) => (
            <div key={i}>
              <dt className="text-base font-semibold text-text-primary">{f.q}</dt>
              <dd className="text-base text-text-secondary mt-1 leading-relaxed">{f.a}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div {...panelProps('settings')}>
        {loading || !businessId ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
        ) : loadError ? (
          <p role="alert" className="text-sm text-error">{loadError}</p>
        ) : (
          <>
            {!canEdit && (
              <p className="text-sm text-text-secondary">
                {connected ? `${entry.title} is connected.` : `${entry.title} is not connected.`} You need permission to
                update settings to change this.
              </p>
            )}
            {canEdit && (
              <PluginSettingsForm
                id={entry.id}
                provider={plugin.provider}
                title={entry.title}
                fields={plugin.fields}
                connection={connection}
                businessId={businessId}
                canEdit
                onSaved={setConnection}
              />
            )}
          </>
        )}
      </div>
    </SettingsPageShell>
  );
}
