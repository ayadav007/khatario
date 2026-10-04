'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  Shield,
  Trash2,
  Users,
} from 'lucide-react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { useToastContext } from '@/contexts/ToastContext';
import { DeleteTenantModal } from '@/components/admin/DeleteTenantModal';
import { allowedAdminStatusesForPlan } from '@/lib/subscription/admin-plan-status';
import { normalizeProductLine } from '@/lib/product-lines';
import {
  PLATFORM_MODULE_LABELS,
  normalizePlatformModule,
  productLineToModule,
  type PlatformModule,
} from '@/lib/platform-modules';

type Plan = { id: string; display_name: string; module_key: PlatformModule };

export type AdminModuleSubscription = {
  module_key: string;
  plan_id: string;
  plan_display_name?: string | null;
  status: string;
  trial_end_date: string | null;
  end_date: string | null;
};

type TenantUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  is_active: boolean;
  is_primary_admin: boolean;
  role_name: string | null;
  last_active_at: string | null;
};

type BillingTx = {
  id: string;
  type: string;
  status: string;
  amount: string;
  plan_id: string | null;
  payment_method: string | null;
  created_at: string;
};

export interface BusinessAdminPanelProps {
  businessId: string;
  businessName: string;
  platformSuspendedAt: string | null;
  platformSuspendReason: string | null;
  /** One row per product the business has a subscription for. */
  moduleSubscriptions: AdminModuleSubscription[];
  /** Products switched on for the business; each gets a card even without a row yet. */
  enabledModules: string[];
  onUpdated: () => void;
  /** Called after a successful hard-delete (e.g. navigate away). */
  onDeleted?: () => void;
}

export function BusinessAdminPanel({
  businessId,
  businessName,
  platformSuspendedAt,
  platformSuspendReason,
  moduleSubscriptions,
  enabledModules,
  onUpdated,
  onDeleted,
}: BusinessAdminPanelProps) {
  const toast = useToastContext();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [billing, setBilling] = useState<BillingTx[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [suspendReason, setSuspendReason] = useState(platformSuspendReason || '');
  const [recordModule, setRecordModule] = useState<PlatformModule>('billing');
  const [recordPlan, setRecordPlan] = useState('');
  const [recordAmount, setRecordAmount] = useState('');
  const [recordStatus, setRecordStatus] = useState<'completed' | 'failed'>('failed');
  const [recordDescription, setRecordDescription] = useState('');

  const suspended = Boolean(platformSuspendedAt);

  const productModules = useMemo<PlatformModule[]>(
    () =>
      Array.from(
        new Set(
          [...enabledModules, ...moduleSubscriptions.map((s) => s.module_key)]
            .map((m) => normalizePlatformModule(m))
            .filter((m): m is PlatformModule => m != null),
        ),
      ),
    [enabledModules, moduleSubscriptions],
  );
  const recordPlans = useMemo(
    () => plans.filter((p) => p.module_key === recordModule),
    [plans, recordModule],
  );

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch(`/api/admin/businesses/${businessId}/users`, platformAdminFetchInit);
      const data = await res.json();
      if (res.ok) setUsers(data.users || []);
    } finally {
      setLoadingUsers(false);
    }
  }, [businessId]);

  const loadBilling = useCallback(async () => {
    const res = await fetch(`/api/admin/businesses/${businessId}/billing`, platformAdminFetchInit);
    const data = await res.json();
    if (res.ok) setBilling(data.transactions || []);
  }, [businessId]);

  useEffect(() => {
    void loadUsers();
    void loadBilling();
    fetch('/api/admin/subscriptions/plans')
      .then((r) => r.json())
      .then((d) => {
        const list = (d.plans || d || []) as { id: string; display_name: string; product_line?: string | null }[];
        if (Array.isArray(list)) {
          setPlans(
            list.map((p) => ({
              id: p.id,
              display_name: p.display_name,
              module_key: productLineToModule(normalizeProductLine(p.product_line)),
            })),
          );
        }
      })
      .catch(() => {});
  }, [businessId, loadUsers, loadBilling]);

  useEffect(() => {
    setSuspendReason(platformSuspendReason || '');
  }, [platformSuspendReason]);

  useEffect(() => {
    if (productModules.length && !productModules.includes(recordModule)) {
      setRecordModule(productModules[0]);
    }
  }, [productModules, recordModule]);

  useEffect(() => {
    if (!recordPlans.some((p) => p.id === recordPlan)) {
      const current = moduleSubscriptions.find((s) => s.module_key === recordModule)?.plan_id;
      setRecordPlan(recordPlans.find((p) => p.id === current)?.id ?? recordPlans[0]?.id ?? '');
    }
  }, [recordPlans, recordPlan, recordModule, moduleSubscriptions]);

  async function patchSubscription(body: Record<string, unknown>) {
    setBusy(`subscription-${String(body.module_key)}`);
    try {
      const res = await fetch(`/api/admin/businesses/${businessId}/subscription`, {
        ...platformAdminFetchInit,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      toast.success('Subscription updated');
      onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  async function toggleSuspend() {
    setBusy('suspend');
    try {
      const res = await fetch(`/api/admin/businesses/${businessId}/suspend`, {
        ...platformAdminFetchInit,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended: !suspended, reason: suspendReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast.success(suspended ? 'Business unsuspended' : 'Business suspended');
      onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function confirmDeleteTenant() {
    setBusy('delete');
    try {
      const res = await fetch(`/api/admin/businesses/${businessId}`, {
        ...platformAdminFetchInit,
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: businessName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      toast.success('Tenant deleted');
      setShowDeleteModal(false);
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setBusy(null);
    }
  }

  async function impersonate(userId?: string) {
    setBusy('impersonate');
    try {
      const res = await fetch(`/api/admin/businesses/${businessId}/impersonate`, {
        ...platformAdminFetchInit,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userId ? { user_id: userId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Impersonation failed');
      window.open(data.url, '_blank', 'noopener,noreferrer');
      toast.success('Opened tenant session in a new tab (link expires in 5 minutes)');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Impersonation failed');
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(userId: string, userName: string) {
    if (!confirm(`Reset password for ${userName}?`)) return;
    setBusy(`pwd-${userId}`);
    try {
      const res = await fetch(`/api/admin/businesses/${businessId}/users/${userId}`, {
        ...platformAdminFetchInit,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_password' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      window.prompt(
        `Temporary password for ${userName} (copy now — shown once):`,
        data.temporary_password,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setBusy(null);
    }
  }

  async function toggleUserActive(user: TenantUser) {
    setBusy(`user-${user.id}`);
    try {
      const res = await fetch(`/api/admin/businesses/${businessId}/users/${user.id}`, {
        ...platformAdminFetchInit,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_active', is_active: !user.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      await loadUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {suspended && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800">Platform suspended</p>
            <p className="text-sm text-red-700 mt-1">
              Tenants cannot log in since{' '}
              {new Date(platformSuspendedAt!).toLocaleString()}.
              {platformSuspendReason ? ` Reason: ${platformSuspendReason}` : ''}
            </p>
          </div>
        </div>
      )}

      {/* Subscription controls: one card per product */}
      <div className="bg-white rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
          <Shield className="w-5 h-5 text-gray-500" />
          Subscription management
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Each product has its own plan. Expired is set automatically when a paid period lapses.
        </p>
        {productModules.length === 0 ? (
          <p className="text-sm text-gray-600">No products enabled for this business.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {productModules.map((moduleKey) => (
              <ProductSubscriptionCard
                key={moduleKey}
                moduleKey={moduleKey}
                subscription={moduleSubscriptions.find((s) => s.module_key === moduleKey) ?? null}
                plans={plans.filter((p) => p.module_key === moduleKey)}
                busy={busy === `subscription-${moduleKey}`}
                onSave={(body) => void patchSubscription({ ...body, module_key: moduleKey })}
              />
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Record payment (manual)</h2>
        <p className="text-sm text-gray-600 mb-3">
          Logs a billing transaction and sends payment success/failure emails to the tenant.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Product</label>
            <select
              value={recordModule}
              onChange={(e) => setRecordModule(e.target.value as PlatformModule)}
              className="border border-gray-300 rounded-lg px-2 py-2 text-sm"
            >
              {productModules.map((m) => (
                <option key={m} value={m}>
                  {PLATFORM_MODULE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Plan</label>
            <select
              value={recordPlan}
              onChange={(e) => setRecordPlan(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-2 text-sm"
            >
              {recordPlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Amount (₹)</label>
            <input
              type="number"
              value={recordAmount}
              onChange={(e) => setRecordAmount(e.target.value)}
              className="w-28 border border-gray-300 rounded-lg px-2 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Outcome</label>
            <select
              value={recordStatus}
              onChange={(e) => setRecordStatus(e.target.value as 'completed' | 'failed')}
              className="border border-gray-300 rounded-lg px-2 py-2 text-sm"
            >
              <option value="failed">Failed</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-600 mb-1">Description</label>
            <input
              type="text"
              value={recordDescription}
              onChange={(e) => setRecordDescription(e.target.value)}
              placeholder="e.g. Razorpay declined"
              className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={busy === 'record-billing' || !recordPlan}
            onClick={async () => {
              setBusy('record-billing');
              try {
                const res = await fetch(`/api/admin/businesses/${businessId}/billing/record`, {
                  ...platformAdminFetchInit,
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    plan_id: recordPlan,
                    module_key: recordModule,
                    amount: parseFloat(recordAmount) || 0,
                    status: recordStatus,
                    description: recordDescription,
                    billing_cycle: 'monthly',
                  }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                toast.success('Billing record saved');
                onUpdated();
                void loadBilling();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed');
              } finally {
                setBusy(null);
              }
            }}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === 'record-billing' ? 'Saving…' : 'Record'}
          </button>
        </div>
      </div>

      {/* Suspend + impersonate + delete */}
      <div className="bg-white rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Access control</h2>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Suspend reason (optional)"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy === 'suspend'}
              onClick={() => void toggleSuspend()}
              className={`px-4 py-2 text-sm rounded-lg border ${
                suspended
                  ? 'border-green-300 text-green-800 hover:bg-green-50'
                  : 'border-red-300 text-red-800 hover:bg-red-50'
              } disabled:opacity-50`}
            >
              {busy === 'suspend' ? '…' : suspended ? 'Unsuspend business' : 'Suspend business'}
            </button>
            <button
              type="button"
              disabled={busy === 'impersonate' || suspended}
              onClick={() => void impersonate()}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-gray-50 inline-flex items-center gap-2 disabled:opacity-50"
              title={suspended ? 'Unsuspend first' : 'Super admin only'}
            >
              <LogIn className="w-4 h-4" />
              {busy === 'impersonate' ? 'Opening…' : 'Login as primary admin'}
            </button>
          </div>

          <div className="pt-4 mt-2 border-t border-border">
            <p className="text-sm text-gray-600 mb-2">
              Permanently remove this tenant and all related data. Prefer suspend if you may need to restore access later.
            </p>
            <button
              type="button"
              disabled={busy != null}
              onClick={() => setShowDeleteModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-red-300 text-red-800 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              Delete tenant permanently
            </button>
          </div>
        </div>
      </div>

      {showDeleteModal && (
        <DeleteTenantModal
          businessId={businessId}
          businessName={businessName}
          deleting={busy === 'delete'}
          onCancel={() => setShowDeleteModal(false)}
          onConfirm={() => void confirmDeleteTenant()}
        />
      )}

      {/* Users */}
      <div className="bg-white rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-gray-500" />
          Tenant users
        </h2>
        {loadingUsers ? (
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-600">No users found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500 border-b border-border">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2 pr-4 font-medium text-gray-900">
                      {u.name}
                      {u.is_primary_admin && (
                        <span className="ml-1 text-xs text-gray-500">(primary)</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">{u.phone}</td>
                    <td className="py-2 pr-4 text-gray-600">{u.role_name || '—'}</td>
                    <td className="py-2 pr-4">
                      <span className={u.is_active ? 'text-green-700' : 'text-red-600'}>
                        {u.is_active ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy != null}
                          onClick={() => void resetPassword(u.id, u.name)}
                          className="text-primary-600 hover:text-primary-800 inline-flex items-center gap-1"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          Reset pwd
                        </button>
                        {!u.is_primary_admin && (
                          <button
                            type="button"
                            disabled={busy != null}
                            onClick={() => void toggleUserActive(u)}
                            className="text-gray-600 hover:text-gray-900"
                          >
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy != null || suspended}
                          onClick={() => void impersonate(u.id)}
                          className="text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Login as
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Billing */}
      {billing.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent billing</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500 border-b border-border">
                <tr>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2">Plan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {billing.map((tx) => (
                  <tr key={tx.id}>
                    <td className="py-2 pr-4">{new Date(tx.created_at).toLocaleDateString()}</td>
                    <td className="py-2 pr-4">{tx.type}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={
                          tx.status === 'completed'
                            ? 'text-green-700'
                            : tx.status === 'failed'
                              ? 'text-red-600'
                              : 'text-gray-600'
                        }
                      >
                        {tx.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4">₹{tx.amount}</td>
                    <td className="py-2">{tx.plan_id || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductSubscriptionCard({
  moduleKey,
  subscription,
  plans,
  busy,
  onSave,
}: {
  moduleKey: PlatformModule;
  subscription: AdminModuleSubscription | null;
  plans: Plan[];
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [selectedPlan, setSelectedPlan] = useState(subscription?.plan_id ?? plans[0]?.id ?? '');
  const [selectedStatus, setSelectedStatus] = useState(subscription?.status ?? 'active');
  const [extendTrialDays, setExtendTrialDays] = useState('7');

  useEffect(() => {
    setSelectedPlan(subscription?.plan_id ?? plans[0]?.id ?? '');
    setSelectedStatus(subscription?.status ?? 'active');
  }, [subscription?.plan_id, subscription?.status, plans]);

  const allowedStatuses = selectedPlan ? allowedAdminStatusesForPlan(selectedPlan) : [];
  const statusValue = (allowedStatuses as string[]).includes(selectedStatus)
    ? selectedStatus
    : allowedStatuses[0] ?? '';
  const isTrialRow = subscription?.status === 'trial';
  const planOptions =
    subscription && !plans.some((p) => p.id === subscription.plan_id)
      ? [
          {
            id: subscription.plan_id,
            display_name: subscription.plan_display_name || subscription.plan_id,
            module_key: moduleKey,
          },
          ...plans,
        ]
      : plans;

  return (
    <div className="rounded-lg border border-border p-4" data-testid={`admin-sub-card-${moduleKey}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-900">{PLATFORM_MODULE_LABELS[moduleKey]}</h3>
        {subscription ? (
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              subscription.status === 'active' || subscription.status === 'trial'
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {subscription.plan_display_name || subscription.plan_id} · {subscription.status}
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
            No subscription
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
          <select
            value={selectedPlan}
            onChange={(e) => setSelectedPlan(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {planOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select
            value={statusValue}
            onChange={(e) => setSelectedStatus(e.target.value)}
            disabled={allowedStatuses.length <= 1}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
          >
            {allowedStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {subscription?.trial_end_date && isTrialRow && (
          <p className="text-sm text-gray-600 col-span-2">
            Trial ends: {new Date(subscription.trial_end_date).toLocaleDateString()}
          </p>
        )}
        {subscription?.end_date && !isTrialRow && (
          <p className="text-sm text-gray-600 col-span-2">
            Period ends: {new Date(subscription.end_date).toLocaleDateString()}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <button
          type="button"
          disabled={busy || !selectedPlan || !statusValue}
          onClick={() => onSave({ plan_id: selectedPlan, status: statusValue })}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save plan & status'}
        </button>
        {isTrialRow && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={extendTrialDays}
              onChange={(e) => setExtendTrialDays(e.target.value)}
              className="w-16 border border-gray-300 rounded-lg px-2 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => onSave({ extend_trial_days: parseInt(extendTrialDays, 10) || 7 })}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Extend trial
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
