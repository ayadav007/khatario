'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useToastContext } from '@/contexts/ToastContext';

type LinkStatus = {
  status: 'pending' | 'approved' | 'rejected' | 'none' | 'disconnected';
  other_business_name: string | null;
  stock_shared: boolean;
};

/**
 * Supplier's view of a customer who is a connected buyer on Khatario:
 * link status, whether they share low stock, and a way to disconnect.
 */
export function HubCustomerLinkCard({ customerId }: { customerId: string }) {
  const toast = useToastContext();
  const [link, setLink] = useState<LinkStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/suppliers/hub/link?customer_id=${customerId}`);
      setLink(res.ok ? await res.json() : null);
    } catch {
      setLink(null);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!link || link.status === 'none') return null;

  const disconnect = async () => {
    if (!confirm('Disconnect this buyer? Past bills stay. New requests, low-stock alerts and bill imports stop.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/suppliers/hub/link?customer_id=${customerId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to disconnect');
      toast.success('Disconnected');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to disconnect');
    } finally {
      setBusy(false);
    }
  };

  const label =
    link.status === 'approved'
      ? 'Connected buyer on Khatario'
      : link.status === 'pending'
        ? 'Asked to add you as supplier'
        : link.status === 'disconnected'
          ? 'Disconnected'
          : 'Link declined';

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Chip variant={link.status === 'approved' ? 'success' : link.status === 'pending' ? 'warning' : 'default'}>
        {label}
      </Chip>
      {link.status === 'approved' && (
        <span className="text-xs text-text-secondary">
          {link.stock_shared ? 'Shares low stock with you' : 'Does not share low stock'}
        </span>
      )}
      {link.status === 'approved' && (
        <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy}>
          Disconnect
        </Button>
      )}
    </div>
  );
}
