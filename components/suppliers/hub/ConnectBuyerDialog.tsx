'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

type Reason = 'gstin' | 'phone' | 'email';

type Match = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  city: string | null;
  reasons: Reason[];
};

type Preview = {
  buyer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    state: string | null;
    gstin: string | null;
    logo_url: string | null;
  };
  already_linked: { id: string; name: string } | null;
  matches: Match[];
};

const REASON: Record<Reason, string> = {
  gstin: 'Same GSTIN',
  phone: 'Same phone',
  email: 'Same email',
};

function place(buyer: Preview['buyer']) {
  return [buyer.city, buyer.state].filter(Boolean).join(', ');
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

/**
 * Shown when a supplier accepts a connection. A matching customer is listed for a yes;
 * otherwise the supplier confirms creating a new customer. Nothing is linked until they choose.
 */
export function ConnectBuyerDialog({
  requestId,
  onClose,
  onConnected,
}: {
  requestId: string;
  onClose: () => void;
  onConnected: (buyerName: string) => void;
}) {
  const toast = useToastContext();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const res = await fetch(`/api/suppliers/hub/connection-requests/${requestId}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not check your customers');
        if (!gone) setPreview(data);
      } catch (e) {
        if (!gone) {
          toastRef.current.error(e instanceof Error ? e.message : 'Could not check your customers');
          onCloseRef.current();
        }
      } finally {
        if (!gone) setLoading(false);
      }
    })();
    return () => {
      gone = true;
    };
  }, [requestId]);

  const choose = async (
    decision: { choice: 'create' } | { choice: 'link'; customer_id: string } | null,
    key: string
  ) => {
    setBusy(key);
    try {
      const res = await fetch(`/api/suppliers/hub/connection-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'accept',
          ...(decision ? { customer_decision: decision } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not connect');
      onConnected(preview?.buyer.name || 'this shop');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not connect');
    } finally {
      setBusy(null);
    }
  };

  const buyer = preview?.buyer;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-buyer-title"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="border-b border-gray-100 px-4 py-4">
          <h2 id="connect-buyer-title" className="text-lg font-semibold text-text-primary">
            {buyer ? `Connect ${buyer.name}` : 'Connect this shop'}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {!preview
              ? 'Checking your customers…'
              : preview.already_linked
                ? 'This shop is already a customer. Accepting keeps that record.'
                : preview.matches.length
                  ? 'A customer on your books matches this shop. Connect that customer, or create a new one.'
                  : 'Nothing on your books matches this shop. Create a customer only if you want to connect.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading || !buyer ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {buyer.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={buyer.logo_url} alt="" className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-700">
                    {initials(buyer.name)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">{buyer.name}</p>
                  <p className="truncate text-sm text-text-secondary">
                    {[place(buyer), buyer.gstin, buyer.phone, buyer.email].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>

              {preview.already_linked && (
                <p className="rounded-xl bg-gray-50 p-3 text-sm text-text-secondary">
                  This shop is already on your books as <span className="font-medium text-text-primary">{preview.already_linked.name}</span>.
                </p>
              )}

              {!preview.already_linked && preview.matches.map((match) => (
                <div key={match.id} className="rounded-xl border border-gray-200 p-3">
                  <p className="font-medium text-text-primary">{match.name}</p>
                  <p className="mt-0.5 text-sm text-text-secondary">
                    {match.reasons.map((r) => REASON[r]).join(' · ')}
                    {match.city ? ` · ${match.city}` : ''}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-muted">
                    {[match.gstin, match.phone, match.email].filter(Boolean).join(' · ')}
                  </p>
                  <Button
                    className="mt-3 w-full"
                    disabled={busy != null}
                    isLoading={busy === match.id}
                    onClick={() => choose({ choice: 'link', customer_id: match.id }, match.id)}
                  >
                    Connect to {match.name}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-100 px-4 py-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy != null}>
            Not now
          </Button>
          {buyer && !preview?.already_linked && (
            <Button
              variant={preview?.matches.length ? 'secondary' : 'primary'}
              disabled={busy != null || loading}
              isLoading={busy === 'create'}
              onClick={() => choose({ choice: 'create' }, 'create')}
            >
              Create {buyer.name}
            </Button>
          )}
          {buyer && preview?.already_linked && (
            <Button disabled={busy != null || loading} isLoading={busy === 'keep'} onClick={() => choose(null, 'keep')}>
              Accept connection
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
