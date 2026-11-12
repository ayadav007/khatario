'use client';

import React from 'react';
import type { InvoiceDraft, InvoiceTotals } from '@/lib/tools/invoice-maker';

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
};

function Party({ title, party, extra }: { title: string; party: InvoiceDraft['seller']; extra?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {party.name && <div className="text-sm font-semibold text-slate-900 break-words">{party.name}</div>}
      {party.address && <div className="text-xs text-slate-700 whitespace-pre-line break-words">{party.address}</div>}
      {party.state && <div className="text-xs text-slate-700">{party.state}</div>}
      {party.gstin && <div className="text-xs text-slate-700">GSTIN: {party.gstin.toUpperCase()}</div>}
      {party.phone && <div className="text-xs text-slate-700">Phone: {party.phone}</div>}
      {extra && <div className="text-xs text-slate-700">{extra}</div>}
    </div>
  );
}

export function InvoicePreview({ draft, totals }: { draft: InvoiceDraft; totals: InvoiceTotals }) {
  const title = draft.seller.gstin.trim() ? 'Tax Invoice' : 'Invoice';
  const placeOfSupply = draft.buyer.state.trim() || draft.seller.state.trim();
  const hasRows = totals.lines.length > 0;

  return (
    <div style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} className="free-invoice-print-area bg-white text-slate-900 border border-slate-200 rounded-lg shadow-sm p-5 sm:p-8 w-full mx-auto max-w-[210mm] min-h-[200mm] flex flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-3">
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        <div className="text-right text-xs text-slate-700">
          {draft.number && <div className="font-semibold">No. {draft.number}</div>}
          {draft.date && <div>Date: {formatDate(draft.date)}</div>}
          {draft.dueDate && <div>Due: {formatDate(draft.dueDate)}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 py-3">
        <Party title="From" party={draft.seller} />
        <Party title="Bill to" party={draft.buyer} extra={placeOfSupply ? `Place of supply: ${placeOfSupply}` : undefined} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-700 text-left">
              {['No.', 'Description', 'HSN/SAC', 'Qty', 'Rate', 'Disc %', 'Taxable', 'GST %', 'Amount'].map((h, i) => (
                <th key={h} className={`border border-slate-300 px-1.5 py-1 font-semibold ${i >= 3 ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {totals.lines.map((l, n) => {
              const src = draft.lines[l.index];
              return (
                <tr key={l.index} className="align-top">
                  <td className="border border-slate-300 px-1.5 py-1">{n + 1}</td>
                  <td className="border border-slate-300 px-1.5 py-1 break-words">{src.description}</td>
                  <td className="border border-slate-300 px-1.5 py-1">{src.hsn}</td>
                  <td className="border border-slate-300 px-1.5 py-1 text-right">{l.quantity}</td>
                  <td className="border border-slate-300 px-1.5 py-1 text-right">{money(l.rate)}</td>
                  <td className="border border-slate-300 px-1.5 py-1 text-right">{l.discountPercent || ''}</td>
                  <td className="border border-slate-300 px-1.5 py-1 text-right">{money(l.taxable)}</td>
                  <td className="border border-slate-300 px-1.5 py-1 text-right">{src.gstRate}%</td>
                  <td className="border border-slate-300 px-1.5 py-1 text-right">{money(l.lineTotal)}</td>
                </tr>
              );
            })}
            {!hasRows && (
              <tr>
                <td colSpan={9} className="border border-slate-300 px-2 py-4 text-center text-slate-400">
                  Add an item to see it here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end pt-3">
        <dl className="w-full max-w-xs text-xs space-y-1">
          <div className="flex justify-between"><dt>Taxable value</dt><dd>{money(totals.taxable)}</dd></div>
          {totals.intraState ? (
            <>
              <div className="flex justify-between"><dt>CGST</dt><dd>{money(totals.cgst)}</dd></div>
              <div className="flex justify-between"><dt>SGST</dt><dd>{money(totals.sgst)}</dd></div>
            </>
          ) : (
            <div className="flex justify-between"><dt>IGST</dt><dd>{money(totals.igst)}</dd></div>
          )}
          <div className="flex justify-between"><dt>Round off</dt><dd>{totals.roundOff < 0 ? '-' : ''}{money(Math.abs(totals.roundOff))}</dd></div>
          <div className="flex justify-between border-t border-slate-300 pt-1 text-sm font-bold"><dt>Total</dt><dd>{money(totals.total)}</dd></div>
        </dl>
      </div>

      <p className="text-xs text-slate-700 pt-3">
        <span className="font-semibold">Amount in words: </span>{totals.totalInWords}
      </p>

      {draft.notes.trim() && (
        <div className="pt-3 text-xs text-slate-700">
          <div className="font-semibold">Notes</div>
          <div className="whitespace-pre-line break-words">{draft.notes}</div>
        </div>
      )}

      <div className="mt-auto pt-6 text-center text-[10px] text-slate-400">Made with Khatario free invoice maker</div>
    </div>
  );
}
