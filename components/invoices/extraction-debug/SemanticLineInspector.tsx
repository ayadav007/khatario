'use client';

import React from 'react';
import type { SemanticInvoiceLineItem } from '@/lib/services/invoice-extract/semanticInvoiceTypes';
import type { RepairedFieldTrace } from '@/lib/services/invoice-extract/invoiceOptimizationTypes';

export type SemanticLineInspectorProps = {
  line: SemanticInvoiceLineItem | null | undefined;
  repairsForRow: RepairedFieldTrace[];
  rejectedSummaries: string[];
};

export function SemanticLineInspector({
  line,
  repairsForRow,
  rejectedSummaries,
}: SemanticLineInspectorProps) {
  if (!line) {
    return (
      <p className="text-sm text-text-secondary">Select a row on the image or pick a line item below.</p>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-text-secondary text-xs uppercase tracking-wide">Row {line.rowIndex}</div>
        <div className="font-medium text-text-primary mt-0.5 break-words">{line.itemName || '—'}</div>
        <div className="text-xs text-text-muted font-mono mt-1">raw: {line.rawRowText || '—'}</div>
      </div>

      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
        <dt className="text-text-secondary">Qty</dt>
        <dd className="font-mono text-text-primary">{line.quantity ?? '—'}</dd>
        <dt className="text-text-secondary">Rate</dt>
        <dd className="font-mono text-text-primary">{line.rate ?? '—'}</dd>
        <dt className="text-text-secondary">Amount</dt>
        <dd className="font-mono text-text-primary">{line.amount ?? '—'}</dd>
        <dt className="text-text-secondary">GST %</dt>
        <dd className="font-mono text-text-primary">
          {line.gstRate ?? '—'} ({line.gstSource ?? '—'})
        </dd>
        <dt className="text-text-secondary">Confidence</dt>
        <dd className="font-mono text-text-primary">{(line.confidence * 100).toFixed(1)}%</dd>
        <dt className="text-text-secondary">HSN</dt>
        <dd className="font-mono text-text-primary">{line.hsnCode ?? '—'}</dd>
      </dl>

      {line.validation?.warnings?.length ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          <div className="font-medium">Validation warnings</div>
          <ul className="list-disc pl-4 mt-1">
            {line.validation.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {line.validation?.suspicious ? (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-900">
          Marked <strong>suspicious</strong> by semantic validator.
        </div>
      ) : null}

      {repairsForRow.length > 0 ? (
        <div className="rounded border border-yellow-200 bg-yellow-50 px-2 py-1.5 text-xs text-yellow-950">
          <div className="font-medium text-yellow-900">Optimization repairs (applied)</div>
          <ul className="mt-1 space-y-1">
            {repairsForRow.map((r, i) => (
              <li key={i} className="font-mono">
                <span className="text-yellow-950">{r.field}</span>: {r.from} → {r.to}{' '}
                <span className="text-yellow-800">(Δ {r.deltaScore.toFixed(3)})</span>
                <div className="text-yellow-900/90 normal-case">{r.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {rejectedSummaries.length > 0 ? (
        <div className="rounded border border-purple-200 bg-purple-50 px-2 py-1.5 text-xs text-purple-950">
          <div className="font-medium">Rejected repair candidates</div>
          <ul className="list-disc pl-4 mt-1">
            {rejectedSummaries.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
