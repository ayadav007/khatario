'use client';

import React from 'react';
import type { GstSectionMarker } from '@/lib/services/invoice-extract/gstSectionParser';
import type { OcrGstPropagationDebug } from '@/lib/services/invoice-extract/gstPropagationEngine';
import type { InvoiceExtractDebugPayload } from '@/lib/services/invoice-extract/pipeline/extractionPipelineTypes';
import type { GstValidationResult } from '@/lib/services/invoice-extract/gstValidationEngine';

export type GstDebugPanelProps = {
  gstPropagation?: OcrGstPropagationDebug | null;
  gstSectionMarkers?: GstSectionMarker[];
  debugPayload?: InvoiceExtractDebugPayload | null;
};

type OcrGstBlock = {
  propagation?: OcrGstPropagationDebug;
  validation?: GstValidationResult;
  section_headers?: Array<{ text: string; y: number; rate: number; confidence: number }>;
};

export function GstDebugPanel({ gstPropagation, gstSectionMarkers, debugPayload }: GstDebugPanelProps) {
  const ocrGst = debugPayload?.ocr_gst as OcrGstBlock | undefined;
  const propagation = gstPropagation ?? ocrGst?.propagation;
  const validation = ocrGst?.validation;
  const headers = ocrGst?.section_headers ?? [];

  return (
    <div className="space-y-3 text-sm">
      {gstSectionMarkers && gstSectionMarkers.length > 0 ? (
        <div>
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Section markers (scan)</div>
          <ul className="text-xs font-mono border border-border rounded p-2 bg-white max-h-28 overflow-auto space-y-1">
            {gstSectionMarkers.map((m, i) => (
              <li key={i}>
                L{m.lineIndex}: {m.gstRate}% — {m.rawText.slice(0, 80)}
                {m.rawText.length > 80 ? '…' : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {headers.length > 0 ? (
        <div>
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Accepted headers (pipeline)</div>
          <ul className="text-xs border border-border rounded p-2 bg-white max-h-28 overflow-auto">
            {headers.map((h, i) => (
              <li key={i} className="font-mono">
                {h.rate}% · y={h.y.toFixed(0)} · {(h.confidence * 100).toFixed(0)}% — {h.text.slice(0, 72)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {propagation?.trace?.propagationSteps?.length ? (
        <div>
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Propagation steps (sample)</div>
          <ul className="text-xs font-mono border border-border rounded p-2 bg-gray-50 max-h-36 overflow-auto space-y-0.5">
            {propagation.trace.propagationSteps.slice(0, 40).map((s, i) => (
              <li key={i}>
                L{s.lineIndex}: {s.action} · rate={s.rate == null ? '—' : s.rate}
              </li>
            ))}
            {propagation.trace.propagationSteps.length > 40 ? (
              <li className="text-text-muted">… +{propagation.trace.propagationSteps.length - 40} more</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {propagation?.overrides?.length ? (
        <div>
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Overrides</div>
          <ul className="text-xs border border-orange-100 bg-orange-50/80 rounded p-2 text-orange-950">
            {propagation.overrides.map((o, i) => (
              <li key={i}>
                #{o.index}: {o.fromRate ?? 'null'} → {o.toRate} ({o.reason})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {propagation?.trace?.footerIgnoredHeaders?.length ? (
        <div>
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Footer-blocked headers</div>
          <ul className="text-xs text-text-muted max-h-24 overflow-auto list-disc pl-4">
            {propagation.trace.footerIgnoredHeaders.map((h, i) => (
              <li key={i}>
                L{h.lineIndex}: {h.reason} — {h.text.slice(0, 60)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {validation ? (
        <div>
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">GST validation</div>
          <div className="rounded border border-border bg-white p-2 text-xs">
            <div>
              ok: <span className="font-mono">{String(validation.ok)}</span> · confidence{' '}
              <span className="font-mono">{(validation.confidence * 100).toFixed(1)}%</span>
            </div>
            {validation.issues.length > 0 ? (
              <ul className="mt-2 list-disc pl-4 text-amber-900 space-y-0.5">
                {validation.issues.map((iss, i) => (
                  <li key={i}>
                    [{iss.severity}] {iss.code}: {iss.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-muted mt-1">No issues recorded.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-muted">No GST validation block on debug payload.</p>
      )}
    </div>
  );
}
