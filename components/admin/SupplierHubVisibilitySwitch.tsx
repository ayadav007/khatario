'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { useToastContext } from '@/contexts/ToastContext';

/** Platform-wide show/hide. This is not a per-plan checkbox. */
export function SupplierHubVisibilitySwitch() {
  const { admin } = useAdmin();
  const toast = useToastContext();
  const [visible, setVisible] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!admin?.id) return;
    let cancelled = false;
    fetch('/api/admin/supplier-hub-visibility', { ...platformAdminFetchInit })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.visible === 'boolean') setVisible(data.visible);
      })
      .catch(() => {
        if (!cancelled) setVisible(null);
      });
    return () => {
      cancelled = true;
    };
  }, [admin?.id]);

  async function toggle() {
    if (visible === null || saving) return;
    const next = !visible;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/supplier-hub-visibility', {
        ...platformAdminFetchInit,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update Supplier Hub');
      setVisible(next);
      toast.success(next ? 'Supplier Hub is visible in the app' : 'Supplier Hub is hidden from every business');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not update Supplier Hub');
    } finally {
      setSaving(false);
    }
  }

  const on = visible === true;

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-900">Supplier Hub</p>
        <p className="mt-1 text-sm text-gray-600">
          {visible === null
            ? 'Loading…'
            : on
              ? 'Shown in the app. The plan checkbox still decides which plans can open it.'
              : 'Hidden from every business. Menus and links are removed until you turn this on.'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={visible === null || saving}
        onClick={toggle}
        className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition disabled:opacity-60 ${
          on ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-800'
        }`}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {visible === null ? 'Loading' : on ? 'Shown' : 'Hidden'}
      </button>
    </div>
  );
}
