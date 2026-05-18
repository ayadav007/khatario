'use client';

import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Download, Copy, FilterX } from 'lucide-react';
import type {
  Gstr13bReconciliationPayload,
  InvoiceReconciliationRow,
  ReconciliationExceptionType,
} from '@/components/gst/gstr13b-reconciliation-types';
import { voucherMismatchReason } from '@/lib/gst/reconciliation-ui-helpers';

function fmtInr(n: number) {
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rowMaxHeadDiff(r: InvoiceReconciliationRow) {
  if (r.max_head_diff != null) return r.max_head_diff;
  return Math.max(
    Math.abs(r.gstr1.igst - r.ledger.igst),
    Math.abs(r.gstr1.cgst - r.ledger.cgst),
    Math.abs(r.gstr1.sgst - r.ledger.sgst),
    Math.abs(r.gstr1.cess - r.ledger.cess)
  );
}

const STATUS_LABEL: Record<InvoiceReconciliationRow['status'], string> = {
  matched: 'Matched',
  missing_in_3b: 'Missing in 3B',
  missing_in_1: 'Missing in GSTR-1',
  value_mismatch: 'Tax mismatch',
};

const EXCEPTION_FILTER_OPTIONS: { value: '' | ReconciliationExceptionType; label: string }[] = [
  { value: '', label: 'All vouchers' },
  { value: 'missing_invoice', label: 'Missing invoice (in 1, not ledger)' },
  { value: 'extra_invoice', label: 'Extra invoice (ledger, not in 1)' },
  { value: 'tax_mismatch', label: 'Tax mismatch' },
  { value: 'date_mismatch', label: 'Date mismatch (see exceptions)' },
  { value: 'cdn_mismatch', label: 'CDN mismatch' },
];

function csvEsc(cell: string | number) {
  const s = String(cell);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type Props = {
  data: Gstr13bReconciliationPayload;
  /** Registration GSTIN shown per row (party GSTIN not in API). */
  issuerGstin: string;
  /** When true, only non-matched vouchers (e.g. deep-link view=mismatches). */
  onlyMismatchedVouchers?: boolean;
  /** IDs from exceptions for date / cdn filters */
  exceptionIdSets: {
    dateMismatch: Set<string>;
    cdnMismatch: Set<string>;
  };
  focusedDocumentId: string | null;
  onClearFocus: () => void;
  search: string;
  onSearchChange: (v: string) => void;
  exceptionFilter: '' | ReconciliationExceptionType;
  onExceptionFilterChange: (v: '' | ReconciliationExceptionType) => void;
  page: number;
  onPageChange: (v: number) => void;
};

const PAGE = 25;

export function ReconciliationInvoiceTable({
  data,
  issuerGstin,
  onlyMismatchedVouchers = false,
  exceptionIdSets,
  focusedDocumentId,
  onClearFocus,
  search,
  onSearchChange,
  exceptionFilter,
  onExceptionFilterChange,
  page,
  onPageChange,
}: Props) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = onlyMismatchedVouchers ? data.vouchers.filter((r) => r.status !== 'matched') : data.vouchers;
    return base.filter((r) => {
      if (focusedDocumentId && r.document_id !== focusedDocumentId) return false;
      if (q && !r.document_id.toLowerCase().includes(q) && !r.voucher_key.toLowerCase().includes(q)) {
        return false;
      }
      if (!exceptionFilter) return true;
      if (exceptionFilter === 'missing_invoice') return r.status === 'missing_in_3b';
      if (exceptionFilter === 'extra_invoice') return r.status === 'missing_in_1';
      if (exceptionFilter === 'tax_mismatch') return r.status === 'value_mismatch';
      if (exceptionFilter === 'date_mismatch') return exceptionIdSets.dateMismatch.has(r.document_id);
      if (exceptionFilter === 'cdn_mismatch') return exceptionIdSets.cdnMismatch.has(r.document_id);
      return true;
    });
  }, [data.vouchers, onlyMismatchedVouchers, search, exceptionFilter, exceptionIdSets, focusedDocumentId]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = filtered.slice(safePage * PAGE, safePage * PAGE + PAGE);

  const setSearch = (v: string) => {
    onSearchChange(v);
    onPageChange(0);
  };
  const setExceptionFilter = (v: '' | ReconciliationExceptionType) => {
    onExceptionFilterChange(v);
    onPageChange(0);
  };

  const exportCsv = () => {
    const headers = [
      'invoice_id',
      'gstin',
      'igst_gstr1',
      'igst_gstr3b',
      'cgst_gstr1',
      'cgst_gstr3b',
      'sgst_gstr1',
      'sgst_gstr3b',
      'cess_gstr1',
      'cess_gstr3b',
      'taxable_value_gstr1',
      'difference_max_head',
      'reason',
      'mode',
      'period',
    ];
    const lines = [
      headers.join(','),
      ...filtered.map((r) => {
        const reason = voucherMismatchReason(r, data.exceptions);
        return [
          csvEsc(r.document_id),
          csvEsc(issuerGstin || ''),
          csvEsc(r.gstr1.igst),
          csvEsc(r.ledger.igst),
          csvEsc(r.gstr1.cgst),
          csvEsc(r.ledger.cgst),
          csvEsc(r.gstr1.sgst),
          csvEsc(r.ledger.sgst),
          csvEsc(r.gstr1.cess),
          csvEsc(r.ledger.cess),
          csvEsc(r.gstr1.taxable_value),
          csvEsc(rowMaxHeadDiff(r)),
          csvEsc(reason),
          csvEsc(data.mode),
          csvEsc(data.gst_period),
        ].join(',');
      }),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `gst_reconciliation_${data.gst_period}_${data.mode}_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyMismatches = async () => {
    const mism = filtered.filter((r) => r.status !== 'matched');
    const text = mism
      .map((r) => {
        const reason = voucherMismatchReason(r, data.exceptions);
        const gst = issuerGstin ? ` | ${issuerGstin}` : '';
        return `${r.document_id} | ${reason} | ${fmtInr(rowMaxHeadDiff(r))}${gst}`;
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(text || '(none)');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Voucher drill-down</h3>
          <p className="text-xs text-text-secondary">
            GSTIN column uses your registration context (party GSTIN is not returned by this API).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-gray-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={copyMismatches}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-gray-50"
            title="Copy mismatches: id | reason | amount [| GSTIN]"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy mismatches
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs font-medium text-text-secondary">Search document / key</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Invoice or CDN id…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div className="min-w-[220px]">
          <label className="mb-1 block text-xs font-medium text-text-secondary">Filter by exception type</label>
          <select
            value={exceptionFilter}
            onChange={(e) => setExceptionFilter(e.target.value as '' | ReconciliationExceptionType)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {EXCEPTION_FILTER_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {(focusedDocumentId || exceptionFilter || search) && (
          <button
            type="button"
            onClick={() => {
              onSearchChange('');
              onExceptionFilterChange('');
              onPageChange(0);
              onClearFocus();
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-text-primary hover:bg-gray-50"
          >
            <FilterX className="h-3.5 w-3.5" />
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1040px] w-full text-sm">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-border bg-gray-100 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">
              <th className="whitespace-nowrap px-3 py-3">Document</th>
              <th
                className="whitespace-nowrap px-3 py-3"
                title="Issuer GSTIN (registration); counterparty not in payload"
              >
                GSTIN
              </th>
              <th className="whitespace-nowrap px-3 py-3 text-right">Taxable (GSTR-1)</th>
              <th className="whitespace-nowrap px-3 py-3 text-right">IGST</th>
              <th className="whitespace-nowrap px-3 py-3 text-right">CGST</th>
              <th className="whitespace-nowrap px-3 py-3 text-right">SGST</th>
              <th className="whitespace-nowrap px-3 py-3 text-right">CESS</th>
              <th className="whitespace-nowrap px-3 py-3 text-center">Status</th>
              <th className="whitespace-nowrap px-3 py-3 text-left" title="Derived from status + exceptions">
                Reason
              </th>
              <th className="whitespace-nowrap px-3 py-3 text-right" title="Max head difference">
                Δ max
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {slice.map((r) => {
              const mismatch = r.status !== 'matched';
              const d = rowMaxHeadDiff(r);
              const reason = voucherMismatchReason(r, data.exceptions);
              return (
                <tr
                  key={r.voucher_key}
                  className={
                    mismatch ? 'bg-red-50/50 border-l-4 border-l-red-400' : 'border-l-4 border-l-transparent'
                  }
                >
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs text-text-primary">{r.document_id}</div>
                    <div className="text-[11px] text-text-muted">{r.voucher_type.replace('_', ' ')}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-text-primary" title="Registration GSTIN">
                    {issuerGstin || '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInr(r.gstr1.taxable_value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    <div>G1 {fmtInr(r.gstr1.igst)}</div>
                    <div className="text-text-muted">3B {fmtInr(r.ledger.igst)}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    <div>G1 {fmtInr(r.gstr1.cgst)}</div>
                    <div className="text-text-muted">3B {fmtInr(r.ledger.cgst)}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    <div>G1 {fmtInr(r.gstr1.sgst)}</div>
                    <div className="text-text-muted">3B {fmtInr(r.ledger.sgst)}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    <div>G1 {fmtInr(r.gstr1.cess)}</div>
                    <div className="text-text-muted">3B {fmtInr(r.ledger.cess)}</div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        mismatch
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : 'border-green-200 bg-green-50 text-green-800'
                      }`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="max-w-[140px] px-3 py-2 text-xs text-text-secondary" title={reason}>
                    {reason}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${mismatch ? 'text-red-600' : 'text-green-700'}`}>
                    {fmtInr(d)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="px-4 py-10 text-center text-sm text-text-secondary">
          {data.status === 'matched' && !focusedDocumentId && !search && !exceptionFilter ? (
            <p className="text-base font-medium text-green-800">✅ All GST data matches for this period</p>
          ) : (
            <p>No vouchers match the current filters.</p>
          )}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex flex-col items-center justify-between gap-2 border-t border-border px-4 py-3 sm:flex-row">
          <p className="text-xs text-text-secondary">
            Showing {safePage * PAGE + 1}–{Math.min((safePage + 1) * PAGE, filtered.length)} of {filtered.length}
            {focusedDocumentId ? (
              <span className="ml-2 font-mono text-text-primary">focused: {focusedDocumentId}</span>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => onPageChange(Math.max(0, safePage - 1))}
              className="rounded-lg border border-border p-1.5 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-text-secondary">
              Page {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => onPageChange(Math.min(pageCount - 1, safePage + 1))}
              className="rounded-lg border border-border p-1.5 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
