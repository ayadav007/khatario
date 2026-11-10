'use client';

import React, { useState } from 'react';
import { format } from 'date-fns';
import { Eye, Loader2, X } from 'lucide-react';
import type { InvoiceHistoryEntry, InvoiceRevisionDetail } from '@/lib/invoices/invoice-history';
import type { FieldChange, LineChange } from '@/lib/invoices/invoice-revision-diff';

const MONEY_FIELDS = new Set([
  'grand_total',
  'subtotal',
  'total_tax',
  'amount_paid',
  'balance_amount',
  'round_off',
  'tds_received',
  'advance_adjusted',
  'unit_price',
  'line_total',
  'amount',
  'discount_amount',
  'tax_amount',
  'taxable_value',
  'cgst_amount',
  'sgst_amount',
  'igst_amount',
]);
const COLLAPSED_ROWS = 5;

function money(value: unknown): string {
  const n = Number(value ?? 0);
  return `₹ ${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function shownValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (MONEY_FIELDS.has(field)) return money(value);
  // Only date columns read as dates; free text such as a PO number "2026-11-001" stays as typed.
  if (typeof value === 'string' && (field.endsWith('_date') || field.endsWith('_at')) && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    if (!Number.isNaN(d.getTime())) return format(d, 'dd MMM yyyy');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function fieldRow(c: FieldChange): string {
  // Ids (customer, branch, item) mean nothing to a reader; say only that they changed.
  if (c.field.endsWith('_id')) return `${c.label} changed`;
  return `${c.label}: ${shownValue(c.field, c.before)} → ${shownValue(c.field, c.after)}`;
}

function lineRows(changes: LineChange[], noun: string): string[] {
  return changes.flatMap((l) => {
    if (l.kind === 'added') return [`Added ${noun} ${l.name}`];
    if (l.kind === 'removed') return [`Removed ${noun} ${l.name}`];
    return l.fields.map((f) => `${l.name}: ${fieldRow(f)}`);
  });
}

function changeRows(entry: InvoiceHistoryEntry): string[] {
  if (!entry.diff) return [];
  return [
    ...entry.diff.header.map(fieldRow),
    ...lineRows(entry.diff.lines, 'item'),
    ...lineRows(entry.diff.charges, 'charge'),
  ];
}

function ChangeList({ rows }: { rows: string[] }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  const shown = open ? rows : rows.slice(0, COLLAPSED_ROWS);
  return (
    <div className="mt-2 rounded-md bg-surface-secondary px-3 py-2 text-xs text-text-secondary space-y-0.5">
      {shown.map((row, i) => (
        <div key={i} className="break-words">
          {row}
        </div>
      ))}
      {rows.length > COLLAPSED_ROWS && (
        <button type="button" className="text-primary-600 hover:underline mt-1" onClick={() => setOpen(!open)}>
          {open ? 'Show fewer' : `Show all ${rows.length} changes`}
        </button>
      )}
    </div>
  );
}

function VersionDialog({ invoiceId, revisionNo, onClose }: { invoiceId: string; revisionNo: number; onClose: () => void }) {
  const [detail, setDetail] = useState<InvoiceRevisionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch(`/api/invoices/${invoiceId}/history/${revisionNo}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json();
        if (!alive) return;
        if (res.ok) setDetail(data);
        else setError(data.error || 'Could not load that version');
      })
      .catch(() => alive && setError('Could not load that version'));
    return () => {
      alive = false;
    };
  }, [invoiceId, revisionNo]);

  const header = (detail?.snapshot.header ?? {}) as Record<string, unknown>;
  const lines = (detail?.snapshot.lines ?? []) as Record<string, unknown>[];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Version ${revisionNo}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Version {revisionNo}</h2>
            {detail && (
              <p className="text-xs text-text-secondary mt-0.5">
                {detail.action_label} by {detail.user_name || 'System'} •{' '}
                {format(new Date(detail.created_at), 'dd MMM yyyy, HH:mm')}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!detail && !error && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
          </div>
        )}
        {detail && (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-4">
              <dt className="text-text-secondary">Invoice number</dt>
              <dd className="text-text-primary">{shownValue('invoice_number', header.invoice_number)}</dd>
              <dt className="text-text-secondary">Invoice date</dt>
              <dd className="text-text-primary">{shownValue('invoice_date', header.invoice_date)}</dd>
              <dt className="text-text-secondary">Status</dt>
              <dd className="text-text-primary capitalize">{shownValue('status', header.status)}</dd>
              <dt className="text-text-secondary">Total</dt>
              <dd className="text-text-primary">{shownValue('grand_total', header.grand_total)}</dd>
            </dl>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-secondary border-b border-border">
                    <th className="py-1.5 pr-2 font-medium">Item</th>
                    <th className="py-1.5 px-2 font-medium text-right">Qty</th>
                    <th className="py-1.5 px-2 font-medium text-right">Rate</th>
                    <th className="py-1.5 px-2 font-medium text-right">GST %</th>
                    <th className="py-1.5 pl-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-b border-border/60">
                      <td className="py-1.5 pr-2 text-text-primary">{String(l.item_name ?? '')}</td>
                      <td className="py-1.5 px-2 text-right">{shownValue('quantity', l.quantity)}</td>
                      <td className="py-1.5 px-2 text-right">{shownValue('unit_price', l.unit_price)}</td>
                      <td className="py-1.5 px-2 text-right">{shownValue('tax_rate', l.tax_rate)}</td>
                      <td className="py-1.5 pl-2 text-right">{shownValue('line_total', l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function InvoiceHistoryTimeline({ invoiceId, entries }: { invoiceId: string; entries: InvoiceHistoryEntry[] }) {
  const [viewing, setViewing] = useState<number | null>(null);

  return (
    <>
      <ol className="relative border-l-2 border-border ml-2 space-y-4">
        {entries.map((h) => (
          <li key={h.id} className="pl-4 relative">
            <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-surface bg-primary-500" />
            <div className="text-sm text-text-primary">
              <span className="font-medium">{h.description}</span>
            </div>
            <div className="text-xs text-text-secondary mt-0.5">
              {h.user_name || h.user_email || 'System'} • {format(new Date(h.created_at), 'dd MMM yyyy, HH:mm')}
            </div>
            {h.reason && <div className="text-xs text-text-secondary mt-1 italic">“{h.reason}”</div>}
            <ChangeList rows={changeRows(h)} />
            {h.kind === 'revision' && h.revision_no !== null && (
              <button
                type="button"
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"
                onClick={() => setViewing(h.revision_no)}
              >
                <Eye className="w-3.5 h-3.5" /> View this version
              </button>
            )}
          </li>
        ))}
      </ol>
      {viewing !== null && <VersionDialog invoiceId={invoiceId} revisionNo={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
