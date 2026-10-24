'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { ReturnStatusBadge } from './ReturnStatusBadge';
import { ReturnDrawer } from './ReturnDrawer';
import { StartReturnDialog } from './StartReturnDialog';
import type { ReturnStatus } from '@/lib/returns/labels';

interface Row {
  id: string;
  return_number: string;
  status: ReturnStatus;
  total_qty: string;
  credit_amount: string;
  requested_at: string;
}

const inr = (n: number | string) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Returns on this order's bill, with "Start return". Shown inside the order drawer. */
export function OrderReturnsSection({
  invoiceId,
  invoiceNumber,
  onChanged,
}: {
  invoiceId: string;
  invoiceNumber: string | null;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/returns?invoice_id=${invoiceId}`).catch(() => null);
    const json = res?.ok ? await res.json().catch(() => null) : null;
    setRows(json?.returns ?? []);
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Returns</h3>
        <button
          type="button"
          onClick={() => setStarting(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Start return
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">No returns on this order.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(r.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <span className="font-medium">{r.return_number}</span>
                <span className="text-xs text-slate-500">{Number(r.total_qty)} item(s)</span>
                {Number(r.credit_amount) > 0 ? <span className="text-xs">{inr(r.credit_amount)}</span> : null}
                <ReturnStatusBadge status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {starting ? (
        <StartReturnDialog
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          onClose={() => setStarting(false)}
          onCreated={(id) => {
            setStarting(false);
            setOpen(id);
            void load();
            onChanged();
          }}
        />
      ) : null}
      {open ? (
        <ReturnDrawer
          id={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            void load();
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
