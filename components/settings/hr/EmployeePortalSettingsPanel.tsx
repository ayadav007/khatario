'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { EmployeePortalAccessCard } from '@/components/settings/EmployeePortalAccessCard';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { STACK_SECTION_CLASS } from '@/lib/page-layout';

export function EmployeePortalSettingsPanel() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [kioskEnabled, setKioskEnabled] = useState(true);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/hr-portal?business_id=${business.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setKioskEnabled(data.settings?.kiosk_enabled !== false);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleKiosk(next: boolean) {
    if (!business?.id) return;
    setKioskEnabled(next);
    setSaving(true);
    try {
      const res = await fetch('/api/settings/hr-portal', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, kiosk_enabled: next }),
      });
      if (!res.ok) {
        setKioskEnabled(!next);
        toast.error('Could not update kiosk setting');
        return;
      }
      toast.success(next ? 'Kiosk enabled' : 'Kiosk disabled');
    } catch {
      setKioskEnabled(!next);
      toast.error('Could not update kiosk setting');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <EmployeePortalAccessCard />

      <section className={STACK_SECTION_CLASS}>
        <h3 className="settings-section-title mb-0">Attendance kiosk</h3>
        <p className="type-body-secondary">
          Shared tablet mode for quick check-in without full employee login. Link appears on your
          employee portal URL under <span className="font-mono text-sm">/employees/kiosk</span>.
        </p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-gray-50 p-4 dark:bg-slate-800/50">
            <span className="text-sm text-text-primary">Allow attendance kiosk</span>
            <button
              type="button"
              role="switch"
              aria-checked={kioskEnabled}
              disabled={saving}
              onClick={() => void toggleKiosk(!kioskEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
                kioskEnabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-slate-600'
              } ${saving ? 'opacity-50' : ''}`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                  kioskEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </label>
        )}
      </section>
    </div>
  );
}
