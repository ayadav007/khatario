'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useCapabilityCheck } from '@/hooks/useCapability';
import type { EinvoiceRegistration } from '@/lib/gst/einvoice-settings';

type RowState = { value: string; saving: boolean; error: string | null; saved: boolean };

export function EinvoiceCoverageCard() {
  const { business } = useAuth();
  const { hasCapability } = useCapabilityCheck();
  const canEdit = hasCapability('settings', 'update');
  const businessId = business?.id;

  const [regs, setRegs] = useState<EinvoiceRegistration[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useCallback((list: EinvoiceRegistration[]) => {
    setRegs(list);
    setRows(Object.fromEntries(list.map((r) => [r.key, { value: r.einvoice_from ?? '', saving: false, error: null, saved: false }])));
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/gsp/einvoice-settings?business_id=${businessId}`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(typeof data.error === 'string' ? data.error : 'Could not load the e-invoicing settings.');
          return;
        }
        apply(data.registrations as EinvoiceRegistration[]);
      } catch {
        if (!cancelled) setLoadError('Could not load the e-invoicing settings.');
      }
    })();
    return () => { cancelled = true; };
  }, [businessId, apply]);

  const patch = (key: string, p: Partial<RowState>) => setRows((r) => ({ ...r, [key]: { ...r[key], ...p } }));

  const save = async (key: string) => {
    if (!businessId) return;
    patch(key, { saving: true, error: null, saved: false });
    try {
      const res = await fetch('/api/gsp/einvoice-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, key, einvoice_from: rows[key]?.value || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        patch(key, { saving: false, error: typeof data.error === 'string' ? data.error : 'Could not save. Try again.' });
        return;
      }
      patch(key, { saving: false, saved: true });
    } catch {
      patch(key, { saving: false, error: 'Could not save. Try again.' });
    }
  };

  return (
    <section aria-label="E-invoicing" className="rounded-xl border border-border bg-card p-5 space-y-4 mt-6">
      <h2 className="text-lg font-semibold text-text-primary">E-invoicing</h2>
      <p className="text-sm text-text-secondary leading-relaxed">
        E-invoicing applies once your total turnover in any year since 2017-18 crossed ₹5 crore. Set the date it started
        for this GSTIN. Leave it blank if it does not apply.
      </p>
      {loadError ? (
        <p role="alert" className="text-sm text-error">{loadError}</p>
      ) : regs === null ? (
        <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary-500" /></div>
      ) : regs.length === 0 ? (
        <p className="text-sm text-text-secondary">Add your GSTIN in business settings to set this up.</p>
      ) : (
        <ul className="space-y-4">
          {regs.map((r) => {
            const s = rows[r.key];
            if (!s) return null;
            return (
              <li key={r.key} className="space-y-2">
                <div>
                  <p className="text-base font-medium text-text-primary">{r.label}</p>
                  <p className="text-sm text-text-secondary">{r.gstin}</p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-52">
                    <Input
                      type="date"
                      label="E-invoicing applies from"
                      value={s.value}
                      disabled={!canEdit || s.saving}
                      onChange={(e) => patch(r.key, { value: e.target.value, saved: false, error: null })}
                    />
                  </div>
                  {canEdit && (
                    <Button onClick={() => save(r.key)} isLoading={s.saving} disabled={s.saving}>Save</Button>
                  )}
                </div>
                {s.error && <p role="alert" className="text-sm text-error">{s.error}</p>}
                {s.saved && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Saved.</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
