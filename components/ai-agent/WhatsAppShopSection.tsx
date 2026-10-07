'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { useToastContext } from '@/contexts/ToastContext';
import { SettingsFloatingSaveBar } from '@/components/settings/SettingsFloatingSaveBar';
import { DEFAULT_SHOP_WELCOME, SHOP_WELCOME_MAX } from '@/lib/whatsapp-shop/constants';
import type { ShopItemScope, ShopSyncSummary } from '@/lib/whatsapp-shop/settings';
import type { ShopStatus } from '@/lib/whatsapp-shop/status';
import { agentFetch, agentJson } from './api';
import { CharCount, FieldLabel, SectionCard } from './SectionCard';

type Draft = {
  enabled: boolean;
  metaCatalogId: string;
  itemScope: ShopItemScope;
  hideOutOfStock: boolean;
  welcomeText: string;
};

const toDraft = (s: ShopStatus): Draft => ({
  enabled: s.settings.enabled,
  metaCatalogId: s.settings.metaCatalogId ?? '',
  itemScope: s.settings.itemScope,
  hideOutOfStock: s.settings.hideOutOfStock,
  welcomeText: s.settings.welcomeText,
});

function Notice({ tone, children }: { tone: 'warn' | 'ok'; children: React.ReactNode }) {
  const Icon = tone === 'warn' ? AlertTriangle : CheckCircle2;
  return (
    <div
      className={
        tone === 'warn'
          ? 'flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200'
          : 'flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200'
      }
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SyncResult({ summary }: { summary: ShopSyncSummary }) {
  const when = new Date(summary.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="space-y-2 text-sm">
      <p className="text-text-secondary">
        Last sync {when}: {summary.pushed} updated, {summary.removed} removed, {summary.unchanged} unchanged
        {summary.skippedNoImage > 0 && `, ${summary.skippedNoImage} skipped (no photo)`}.
      </p>
      {summary.errors.length > 0 && (
        <Notice tone="warn">
          <p className="font-medium">Meta rejected {summary.errors.length} item(s):</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {summary.errors.slice(0, 5).map((e, i) => (
              <li key={i}>
                {e.item}: {e.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}

export function WhatsAppShopSection({ businessId }: { businessId: string }) {
  const toast = useToastContext();
  const [status, setStatus] = useState<ShopStatus | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const apply = useCallback((s: ShopStatus) => {
    setStatus(s);
    setDraft(toDraft(s));
  }, []);

  useEffect(() => {
    agentFetch<ShopStatus>(businessId, '/api/whatsapp/shop')
      .then(apply)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load'));
  }, [businessId, apply]);

  const dirty = !!status && !!draft && JSON.stringify(draft) !== JSON.stringify(toDraft(status));
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await agentFetch<ShopStatus & { warnings?: string[] }>(businessId, '/api/whatsapp/shop', {
        method: 'PUT',
        body: agentJson({ ...draft, metaCatalogId: draft.metaCatalogId.trim() || null }),
      });
      apply(res);
      (res.warnings ?? []).forEach((w) => toast.warning(w));
      toast.success('WhatsApp shop saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await agentFetch<{ summary: ShopSyncSummary; status: ShopStatus }>(businessId, '/api/whatsapp/shop/sync', {
        method: 'POST',
        body: agentJson({}),
      });
      apply(res.status);
      const s = res.summary;
      if (s.errors.length) toast.warning(`Synced with ${s.errors.length} item(s) rejected by Meta`);
      else toast.success(`Catalog synced: ${s.pushed} updated, ${s.removed} removed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  if (loadError || !status || !draft) {
    return (
      <SectionCard id="shop" icon={ShoppingBag} title="WhatsApp shop" description="Let customers browse, add to cart and pay in WhatsApp.">
        {loadError ? (
          <p className="text-sm text-error">{loadError}</p>
        ) : (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        )}
      </SectionCard>
    );
  }

  const cloud = status.transport === 'cloud';
  const catalogSaved = !!status.settings.metaCatalogId;

  return (
    <>
    <SectionCard
      id="shop"
      icon={ShoppingBag}
      title="Take orders on WhatsApp"
      description="Customers send “menu” or “catalog”, pick items, send the cart and get a payment link. Paid orders are invoiced automatically."
    >
      <div className="space-y-5">
        <Switch
          checked={draft.enabled && status.gatewayConfigured}
          onChange={(enabled) => {
            if (enabled && !status.gatewayConfigured) {
              toast.error('Connect a payment gateway in Settings → Payments before taking WhatsApp orders.');
              return;
            }
            patch({ enabled });
          }}
          label="Take orders on WhatsApp"
          description={
            !status.gatewayConfigured
              ? 'Requires a payment gateway (Razorpay etc.). Manual UPI alone cannot confirm prepaid WhatsApp orders.'
              : cloud
                ? 'Your number uses the Cloud API: customers get WhatsApp’s own catalog and cart once a Meta catalog is synced. Until then they get a shop link.'
                : 'Your number is connected by QR code: customers get a link to a shop page with a cart. WhatsApp’s built-in catalog needs the Cloud API.'
          }
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-text-secondary">Items on sale</p>
            <p className="text-xl font-semibold text-text-primary">{status.items}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-text-secondary">Without a photo</p>
            <p className="text-xl font-semibold text-text-primary">{status.itemsWithoutImage}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-text-secondary">In Meta catalog</p>
            <p className="text-xl font-semibold text-text-primary">{cloud ? status.syncedItems : '—'}</p>
          </div>
        </div>

        {!status.gatewayConfigured && (
          <Notice tone="warn">
            WhatsApp orders need a payment gateway (e.g. Razorpay). Manual UPI alone is not enough — customers must pay via a
            hosted payment link so payment can be confirmed automatically.{' '}
            <Link href="/settings/payments" className="font-medium underline">Connect a payment gateway</Link>
          </Notice>
        )}
      </div>
    </SectionCard>

    <SectionCard
      id="shop-items"
      title="What's on sale"
      description="Which items customers see, and the message sent with the catalog or shop link."
    >
      <div className="space-y-5">
        <div>
          <FieldLabel>Which items to sell</FieldLabel>
          <div className="space-y-2">
            {(
              [
                ['all', 'All active items with a selling price'],
                ['store', 'Only items marked “Show in online store”'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                <input
                  type="radio"
                  name="wa-shop-scope"
                  checked={draft.itemScope === value}
                  onChange={() => patch({ itemScope: value })}
                  className="h-4 w-4 accent-primary-600"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-text-secondary">Items with variants are not listed yet.</p>
        </div>

        <Switch
          checked={draft.hideOutOfStock}
          onChange={(hideOutOfStock) => patch({ hideOutOfStock })}
          label="Hide items that are out of stock"
          description="Leave off if you don’t track stock in Khatario."
        />

        <div>
          <FieldLabel hint="Sent with the catalog or shop link.">Welcome message</FieldLabel>
          <Textarea
            rows={3}
            value={draft.welcomeText}
            maxLength={SHOP_WELCOME_MAX}
            placeholder={DEFAULT_SHOP_WELCOME}
            onChange={(e) => patch({ welcomeText: e.target.value })}
          />
          <CharCount value={draft.welcomeText} max={SHOP_WELCOME_MAX} />
        </div>
      </div>
    </SectionCard>

        {cloud && (
          <SectionCard
            id="shop-catalog"
            title="WhatsApp catalog"
            description="For Cloud API numbers. Create a catalog in Meta Commerce Manager, give your WhatsApp system user access to it (catalog_management), then paste its ID. Khatario connects it, turns on the cart and keeps products in sync."
          >
          <div className="space-y-3">
            <div>
              <FieldLabel>Catalog ID</FieldLabel>
              <input
                className="input"
                inputMode="numeric"
                value={draft.metaCatalogId}
                placeholder="e.g. 194836987003835"
                onChange={(e) => patch({ metaCatalogId: e.target.value.replace(/\D/g, '') })}
              />
            </div>
            {catalogSaved && (
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="secondary" onClick={() => void sync()} isLoading={syncing} disabled={dirty}>
                  <RefreshCw className="mr-1.5 h-4 w-4" /> Sync items to catalog
                </Button>
                {dirty && <span className="text-xs text-text-secondary">Save first, then sync.</span>}
              </div>
            )}
            {status.settings.lastSyncSummary && <SyncResult summary={status.settings.lastSyncSummary} />}
            {catalogSaved && status.itemsWithoutImage > 0 && (
              <p className="text-xs text-text-secondary">
                Meta only lists products with a photo (at least 500 × 500 px). Add photos in Items to include the other{' '}
                {status.itemsWithoutImage}.
              </p>
            )}
            <a
              href="https://business.facebook.com/commerce"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline"
            >
              Open Commerce Manager <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          </SectionCard>
        )}

      {dirty && (
        <SettingsFloatingSaveBar align="between">
          <span className="text-sm text-text-secondary">You have unsaved shop changes</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => apply(status)} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" onClick={() => void save()} isLoading={saving}>
              Save shop
            </Button>
          </div>
        </SettingsFloatingSaveBar>
      )}
    </>
  );
}
