'use client';

import { useEffect, useState } from 'react';
import { Loader2, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { leadsApi } from './leadLabels';

const field =
  'w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark';
const labelCls = 'mb-1 block text-xs font-medium text-text-secondary';

/**
 * Links a lead to a customer: the customer whose phone matches, or a new one made with the existing
 * POST /api/customers and then linked with POST convert { customer_id }.
 */
export function ConvertLeadDialog({
  leadId,
  name: initialName,
  phone: initialPhone,
  onClose,
  onConverted,
}: {
  leadId: string;
  name: string;
  phone: string;
  onClose: () => void;
  onConverted: () => void;
}) {
  const [match, setMatch] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [gstin, setGstin] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void leadsApi<{ match: { id: string; name: string } | null }>(`/api/whatsapp/leads/${leadId}/convert`).then(({ ok, data }) => {
      if (cancelled) return;
      if (!ok) setError(data.error || 'Could not look up the customer');
      setMatch(ok ? data.match : null);
    });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  async function link(customerId: string): Promise<boolean> {
    const { ok, data } = await leadsApi(`/api/whatsapp/leads/${leadId}/convert`, {
      method: 'POST',
      body: JSON.stringify({ customer_id: customerId }),
    });
    if (!ok) setError(data.error || 'Could not link the customer');
    return ok;
  }

  async function linkMatch() {
    if (!match) return;
    setBusy(true);
    setError(null);
    try {
      if (await link(match.id)) onConverted();
    } finally {
      setBusy(false);
    }
  }

  async function createAndLink() {
    if (!name.trim()) {
      setError('Enter the customer name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { name: name.trim(), phone: phone.trim() };
      if (gstin.trim()) body.gstin = gstin.trim().toUpperCase();
      if (address.trim()) body.address = address.trim();
      const { ok, data } = await leadsApi<{ customer?: { id: string } }>('/api/customers', { method: 'POST', body: JSON.stringify(body) });
      // A phone or email already on a customer comes back as that customer (deduplicated), which is the one to link.
      if (!ok || !data.customer?.id) {
        setError(data.error || 'Could not create the customer');
        return;
      }
      if (await link(data.customer.id)) onConverted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Convert to customer">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl dark:bg-surface-dark">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <UserCheck className="h-5 w-5 text-primary-600" />
          Convert to customer
        </h2>

        {match === undefined ? (
          <p className="mt-4 flex items-center text-sm text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Looking for a customer with this number…
          </p>
        ) : match ? (
          <>
            <p className="mt-2 text-sm text-text-secondary">
              <span className="font-medium text-text-primary">{match.name}</span> already has this number. Link this lead to them.
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void linkMatch()} disabled={busy}>
                {busy ? 'Linking…' : `Link to ${match.name}`}
              </Button>
            </div>
          </>
        ) : (
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createAndLink();
            }}
          >
            <p className="text-sm text-text-secondary">No customer has this number yet. Add one and link the lead.</p>
            <div>
              <label className={labelCls} htmlFor="convert-name">Name</label>
              <input id="convert-name" className={field} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className={labelCls} htmlFor="convert-phone">Phone</label>
              <input id="convert-phone" className={field} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className={labelCls} htmlFor="convert-gstin">GSTIN (optional)</label>
              <input id="convert-gstin" className={`${field} uppercase`} maxLength={15} value={gstin} onChange={(e) => setGstin(e.target.value)} />
            </div>
            <div>
              <label className={labelCls} htmlFor="convert-address">Address (optional)</label>
              <textarea id="convert-address" className={field} rows={2} maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? 'Saving…' : 'Create and link'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
