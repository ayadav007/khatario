'use client';

import { useCallback, useEffect, useState } from 'react';
import { hasActiveEwayBill } from '@/lib/gst/eway-generate-form';
import type { EwayBillView } from '@/lib/gst/eway-bill-records';

/**
 * The e-way bills recorded for one document. `ready` is false while loading and when the list
 * could not be loaded (for example the plan has no e-way bills), so callers show nothing then.
 */
export function useDocumentEwayBills(sourceType: 'invoice' | 'delivery_challan', sourceId: string, enabled = true) {
  const [bills, setBills] = useState<EwayBillView[]>([]);
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !sourceId) return;
    try {
      const res = await fetch(`/api/eway-bills?source_type=${sourceType}&source_id=${encodeURIComponent(sourceId)}`, { credentials: 'include' });
      if (!res.ok) {
        setReady(false);
        setSettled(true);
        return;
      }
      const data = await res.json();
      setBills(data.eway_bills || []);
      setReady(true);
      setSettled(true);
    } catch {
      setReady(false);
      setSettled(true);
    }
  }, [enabled, sourceType, sourceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = bills.find((b) => b.status === 'active') ?? null;
  return { ready, settled, active, canGenerate: ready && !hasActiveEwayBill(bills), refresh };
}

/** Shows the active bill's number, validity and Print link where Generate would be. */
export function ActiveEwayBillLine({ bill }: { bill: EwayBillView }) {
  return (
    <p className="text-xs text-text-secondary">
      E-way bill {bill.ewb_number}
      {bill.valid_until ? `, valid until ${new Date(bill.valid_until).toLocaleString('en-IN')}` : ''}
      {bill.print_url ? (
        <>
          {' '}
          <a className="text-primary-700 underline" href={bill.print_url} target="_blank" rel="noopener noreferrer">
            Print
          </a>
        </>
      ) : null}
    </p>
  );
}
