'use client';

import React from 'react';
import type { InvoiceOptimizationResult } from '@/lib/services/invoice-extract/invoiceOptimizationTypes';

export type OptimizationTracePanelProps = {
  optimization: InvoiceOptimizationResult | null | undefined;
};

export function OptimizationTracePanel({ optimization }: OptimizationTracePanelProps) {
  if (!optimization) {
    return <p className="text-sm text-text-secondary">No optimization result attached.</p>;
  }

  const { baselineScore, optimizationScore, scoreBreakdown, repairedFields, rejectedCandidates, warnings } =
    optimization;

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-border bg-white px-2 py-1.5">
          <div className="text-text-secondary">Baseline score</div>
          <div className="font-mono text-text-primary">{baselineScore.toFixed(4)}</div>
        </div>
        <div className="rounded border border-border bg-white px-2 py-1.5">
          <div className="text-text-secondary">Optimized score</div>
          <div className="font-mono text-green-800">{optimizationScore.toFixed(4)}</div>
        </div>
      </div>

      <div>
        <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Score breakdown</div>
        <div className="rounded border border-border bg-gray-50 p-2 font-mono text-xs grid grid-cols-2 gap-y-1">
          <span>line</span>
          <span className="text-right">{scoreBreakdown.line.toFixed(4)}</span>
          <span>slab</span>
          <span className="text-right">{scoreBreakdown.slab.toFixed(4)}</span>
          <span>invoice</span>
          <span className="text-right">{scoreBreakdown.invoice.toFixed(4)}</span>
          <span>ocr trust</span>
          <span className="text-right">{scoreBreakdown.ocrTrust.toFixed(4)}</span>
          <span>region trust</span>
          <span className="text-right">{scoreBreakdown.regionTrust.toFixed(4)}</span>
          <span className="font-medium">total</span>
          <span className="text-right font-medium">{scoreBreakdown.total.toFixed(4)}</span>
        </div>
      </div>

      <div>
        <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">
          Applied repairs ({repairedFields.length})
        </div>
        {repairedFields.length === 0 ? (
          <p className="text-xs text-text-muted">None</p>
        ) : (
          <ul className="max-h-40 overflow-auto text-xs font-mono space-y-1 border border-border rounded p-2 bg-white">
            {repairedFields.map((r, i) => (
              <li key={i}>
                row {r.rowIndex} · {r.field}: {r.from} → {r.to} ({r.reason})
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">
          Rejected candidates ({rejectedCandidates.length})
        </div>
        {rejectedCandidates.length === 0 ? (
          <p className="text-xs text-text-muted">None</p>
        ) : (
          <ul className="max-h-32 overflow-auto text-xs border border-border rounded p-2 bg-purple-50/80 text-purple-950">
            {rejectedCandidates.map((r, i) => (
              <li key={i}>
                row {r.rowIndex}: {r.summary}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Warnings</div>
        {warnings.length === 0 ? (
          <p className="text-xs text-text-muted">None</p>
        ) : (
          <ul className="list-disc pl-4 text-xs text-amber-900">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="text-xs text-text-muted border-t border-border pt-2">
        Rollback events are not emitted by the current optimizer; use warnings + rejected candidates to infer dead
        ends.
      </div>
    </div>
  );
}
