'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Button } from '@/components/ui/Button';
import { LayoutGrid, Loader2, CheckCircle2, Plus, Home, PowerOff } from 'lucide-react';
import type { PlatformModule } from '@/lib/platform-modules';
import { MODULE_ADD_CONFIG } from '@/lib/subscription/module-entitlements';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';

type ModuleCard = {
  module_key: PlatformModule;
  label: string;
  description: string;
  enabled: boolean;
  is_primary: boolean;
  subscription: {
    plan_id: string;
    plan_display_name: string;
    status: string;
    trial_end_date: string | null;
  } | null;
  can_add: boolean;
};

function ProductsSettingsPanel({ businessId }: { businessId: string }) {
  const toast = useToastContext();
  const { refresh } = useAuth();
  const searchParams = useSearchParams();
  const upsell = searchParams.get('upsell');

  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<ModuleCard[]>([]);
  const [primaryModule, setPrimaryModule] = useState<PlatformModule | null>(null);
  const [subscriptionModal, setSubscriptionModal] = useState<PlatformModule | null>(null);
  const [settingPrimary, setSettingPrimary] = useState<PlatformModule | null>(null);
  const [disabling, setDisabling] = useState<PlatformModule | null>(null);

  const loadModules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/modules', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setModules(data.modules ?? []);
      setPrimaryModule(data.primary_module ?? null);
    } catch {
      toast.error('Could not load your products.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  const handleAdd = (moduleKey: PlatformModule) => {
    const config = MODULE_ADD_CONFIG[moduleKey as Exclude<PlatformModule, 'crm'>];
    if (!config) {
      toast.error('This product is not available yet.');
      return;
    }
    setSubscriptionModal(moduleKey);
  };

  const handleSetPrimary = async (moduleKey: PlatformModule) => {
    setSettingPrimary(moduleKey);
    try {
      const res = await fetch('/api/modules/primary', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module_key: moduleKey, business_id: businessId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not update primary product.');
        return;
      }
      toast.success(data.message || 'Primary product updated.');
      setPrimaryModule(data.primary_module);
      await refresh();
      await loadModules();
    } catch {
      toast.error('Something went wrong. Try again.');
    } finally {
      setSettingPrimary(null);
    }
  };

  const handleDisable = async (moduleKey: PlatformModule) => {
    if (
      !window.confirm(
        `Disable ${modules.find((m) => m.module_key === moduleKey)?.label ?? moduleKey}? You can add it again later from this page.`,
      )
    ) {
      return;
    }
    setDisabling(moduleKey);
    try {
      const res = await fetch('/api/modules/disable', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module_key: moduleKey, business_id: businessId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not disable product.');
        return;
      }
      toast.success(data.message || 'Product disabled.');
      await refresh();
      await loadModules();
    } catch {
      toast.error('Something went wrong. Try again.');
    } finally {
      setDisabling(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  const upsellModule = upsell ? modules.find((m) => m.module_key === upsell && !m.enabled) : null;
  const enabledCount = modules.filter((m) => m.enabled).length;

  return (
    <div className="space-y-6">
      {upsellModule ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">That area needs {upsellModule.label}</p>
          <p className="mt-1 text-amber-800">{upsellModule.description}</p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => handleAdd(upsellModule.module_key)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add {upsellModule.label}
          </Button>
        </div>
      ) : null}

      <p className="text-sm text-text-secondary">
        Each product has its own plan. Console seats (admin logins) are shared across products;
        HR employee roster limits apply only when HR is enabled. Attendance-only workers do not
        use a console seat.
      </p>

      {enabledCount > 1 ? (
        <div className="rounded-xl border border-border bg-gray-50 p-4 dark:bg-slate-800/40">
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Primary product
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            Controls your default home screen after login. Billing history and legacy sync follow
            the primary product&apos;s subscription row.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((mod) => (
          <article
            key={mod.module_key}
            className="flex flex-col rounded-xl border border-border bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold text-text-primary">{mod.label}</h3>
              {mod.enabled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Active
                </span>
              ) : null}
            </div>
            <p className="mt-2 flex-1 text-sm text-text-secondary">{mod.description}</p>

            {mod.enabled && mod.subscription ? (
              <p className="mt-3 text-xs text-text-muted">
                Plan: {mod.subscription.plan_display_name}
                {mod.subscription.status === 'trial' && mod.subscription.trial_end_date
                  ? ` · Trial until ${mod.subscription.trial_end_date}`
                  : ''}
              </p>
            ) : null}

            {mod.enabled && primaryModule === mod.module_key ? (
              <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-text-secondary">
                <Home className="h-3.5 w-3.5" />
                Primary product (default home)
              </p>
            ) : null}

            <div className="mt-4 space-y-2">
              {mod.enabled ? (
                <>
                  {enabledCount > 1 && primaryModule !== mod.module_key ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={() => void handleSetPrimary(mod.module_key)}
                      disabled={settingPrimary === mod.module_key}
                    >
                      {settingPrimary === mod.module_key ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Home className="mr-2 h-4 w-4" />
                      )}
                      Set as primary
                    </Button>
                  ) : null}
                  {enabledCount > 1 ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full text-red-600 hover:bg-red-50"
                      onClick={() => void handleDisable(mod.module_key)}
                      disabled={disabling === mod.module_key}
                    >
                      {disabling === mod.module_key ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <PowerOff className="mr-2 h-4 w-4" />
                      )}
                      Disable product
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" className="w-full" disabled>
                      Enabled
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => handleAdd(mod.module_key)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add {mod.label}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>

      {/* Subscription plan selection modal */}
      {subscriptionModal ? (
        <UpgradeModal
          moduleKey={subscriptionModal}
          showTrialOption
          featureName={
            MODULE_ADD_CONFIG[subscriptionModal as Exclude<PlatformModule, 'crm'>]?.label ??
            subscriptionModal
          }
          onClose={() => setSubscriptionModal(null)}
          onUpgradeSuccess={async () => {
            setSubscriptionModal(null);
            await refresh();
            await loadModules();
          }}
        />
      ) : null}
    </div>
  );
}

export default function ProductsSettingsPage() {
  const { business } = useAuth();

  return (
    <SettingsPageShell
      title="Your products"
      description="Billing, HR, and Connect — add only what you need"
      icon={LayoutGrid}
    >
      {business?.id ? <ProductsSettingsPanel businessId={business.id} /> : null}
    </SettingsPageShell>
  );
}
