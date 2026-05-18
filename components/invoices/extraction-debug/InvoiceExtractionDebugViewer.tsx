'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { FileJson, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getParserVersionMetadata } from '@/lib/services/invoice-extract/parserVersion';
import type { InvoiceExtractionDebugViewerProps, OverlayToggles } from './invoiceExtractionDebugTypes';
import { DEFAULT_OVERLAY_TOGGLES } from './invoiceExtractionDebugTypes';
import { InvoiceOverlayCanvas } from './InvoiceOverlayCanvas';
import { SemanticLineInspector } from './SemanticLineInspector';
import { OptimizationTracePanel } from './OptimizationTracePanel';
import { GstDebugPanel } from './GstDebugPanel';
import type { InvoiceSpatialDocument } from '@/lib/services/invoice-extract/ocrSpatialParser';
import { hitTestRowAt, hitTestWordAt } from './RegionOverlayLayer';

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJson(filename: string, data: unknown) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
}

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="rounded-md border border-border bg-white open:shadow-sm"
      open={defaultOpen}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-text-primary border-b border-border bg-gray-50 rounded-t-md">
        {title}
      </summary>
      <div className="p-3 max-h-72 overflow-auto">{children}</div>
    </details>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-border"
      />
      {label}
    </label>
  );
}

async function renderAnnotatedPng(params: {
  imageSrc: string;
  doc: InvoiceSpatialDocument;
  semanticParse: InvoiceExtractionDebugViewerProps['semanticParse'];
  optimization: InvoiceExtractionDebugViewerProps['optimization'];
}): Promise<Blob | null> {
  const { imageSrc, doc, semanticParse, optimization } = params;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = doc.pageWidth;
      canvas.height = doc.pageHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, doc.pageWidth, doc.pageHeight);

      const suspicious = new Set(semanticParse?.debug.suspiciousRows ?? []);
      const rejected = new Set(optimization?.rejectedCandidates.map((r) => r.rowIndex) ?? []);
      const repaired = new Set(optimization?.repairedFields.map((r) => r.rowIndex) ?? []);

      ctx.lineWidth = 1.5;
      for (const tr of doc.tableRegions) {
        ctx.strokeStyle = '#64748b';
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(tr.bbox.minX, tr.bbox.minY, tr.bbox.maxX - tr.bbox.minX, tr.bbox.maxY - tr.bbox.minY);
      }
      ctx.setLineDash([]);

      for (const row of doc.rows) {
        let stroke = '#2563eb';
        if (suspicious.has(row.rowIndex)) stroke = '#dc2626';
        else if (rejected.has(row.rowIndex)) stroke = '#9333ea';
        else if (repaired.has(row.rowIndex)) stroke = '#ca8a04';
        ctx.strokeStyle = stroke;
        ctx.strokeRect(row.bbox.minX, row.bbox.minY, row.bbox.maxX - row.bbox.minX, row.bbox.maxY - row.bbox.minY);
      }

      canvas.toBlob((b) => resolve(b), 'image/png');
    };
    img.onerror = () => resolve(null);
    img.src = imageSrc;
  });
}

export function InvoiceExtractionDebugViewer({
  imageSrc,
  imageAlt,
  spatialDocument,
  semanticParse,
  optimization,
  gstPropagation,
  gstSectionMarkers,
  debugPayload,
  learningSnapshot,
  telemetrySummary,
  indianExtract,
  className,
}: InvoiceExtractionDebugViewerProps) {
  const [toggles, setToggles] = useState<OverlayToggles>(DEFAULT_OVERLAY_TOGGLES);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  const setToggle = (k: keyof OverlayToggles, v: boolean) => {
    setToggles((prev) => ({ ...prev, [k]: v }));
  };

  const lineForRow = useMemo(() => {
    if (!semanticParse?.lineItems || selectedRowIndex == null) return null;
    return semanticParse.lineItems.find((l) => l.rowIndex === selectedRowIndex) ?? null;
  }, [semanticParse, selectedRowIndex]);

  const repairsForRow = useMemo(() => {
    if (selectedRowIndex == null || !optimization?.repairedFields) return [];
    return optimization.repairedFields.filter((r) => r.rowIndex === selectedRowIndex);
  }, [optimization, selectedRowIndex]);

  const rejectedForRow = useMemo(() => {
    if (selectedRowIndex == null || !optimization?.rejectedCandidates) return [];
    return optimization.rejectedCandidates
      .filter((r) => r.rowIndex === selectedRowIndex)
      .map((r) => r.summary);
  }, [optimization, selectedRowIndex]);

  const exportBundle = useCallback(() => {
    downloadJson('invoice-extraction-debug.json', {
      imageAlt,
      spatialDocument,
      semanticParse,
      optimization,
      gstPropagation,
      gstSectionMarkers,
      debugPayload,
      learningSnapshot,
      telemetrySummary,
      indianExtract,
      parserVersions: getParserVersionMetadata(),
    });
  }, [
    imageAlt,
    spatialDocument,
    semanticParse,
    optimization,
    gstPropagation,
    gstSectionMarkers,
    debugPayload,
    learningSnapshot,
    telemetrySummary,
    indianExtract,
  ]);

  const exportOptimization = useCallback(() => {
    if (!optimization) return;
    downloadJson('invoice-optimization-trace.json', optimization);
  }, [optimization]);

  const exportPng = useCallback(async () => {
    if (!spatialDocument) return;
    const blob = await renderAnnotatedPng({
      imageSrc,
      doc: spatialDocument,
      semanticParse,
      optimization,
    });
    if (blob) downloadBlob('invoice-extraction-annotated.png', blob);
  }, [imageSrc, spatialDocument, semanticParse, optimization]);

  const meta = getParserVersionMetadata();

  return (
    <div
      className={clsx(
        'flex flex-col lg:flex-row gap-4 min-h-[560px] w-full bg-surface border border-border rounded-lg p-3',
        className,
      )}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-text-primary">Overlays</span>
          {(Object.keys(toggles) as (keyof OverlayToggles)[]).map((k) => (
            <ToggleRow key={k} label={k} checked={toggles[k]} onChange={(v) => setToggle(k, v)} />
          ))}
        </div>

        {spatialDocument ? (
          <InvoiceOverlayCanvas
            imageSrc={imageSrc}
            imageAlt={imageAlt}
            spatialDocument={spatialDocument}
            semanticParse={semanticParse}
            optimization={optimization}
            toggles={toggles}
            selectedRowIndex={selectedRowIndex}
            onSelectRow={setSelectedRowIndex}
          />
        ) : (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-text-secondary text-sm">
            No <code className="font-mono text-xs">spatialDocument</code> — image shown without overlays.
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSrc} alt={imageAlt ?? ''} className="max-w-full mt-4 rounded border border-border" />
          </div>
        )}
      </div>

      <div className="w-full lg:w-[min(440px,100%)] flex flex-col gap-3 shrink-0">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={exportBundle}>
            <FileJson className="w-4 h-4" />
            Debug JSON
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={exportOptimization} disabled={!optimization}>
            <FileJson className="w-4 h-4" />
            Opt trace
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={exportPng}
            disabled={!spatialDocument}
          >
            <ImageIcon className="w-4 h-4" />
            Annotated PNG
          </Button>
        </div>

        <Section title="1. OCR summary" defaultOpen>
          {spatialDocument ? (
            <div className="text-xs font-mono space-y-1 text-text-primary">
              <div>pages: {spatialDocument.pageCount}</div>
              <div>
                size: {Math.round(spatialDocument.pageWidth)}×{Math.round(spatialDocument.pageHeight)} px
              </div>
              <div>words: {spatialDocument.words.length}</div>
              <div>rows: {spatialDocument.rows.length}</div>
              <div>columns: {spatialDocument.columns.length}</div>
              <div>table regions: {spatialDocument.tableRegions.length}</div>
              <div>median word height: {spatialDocument.debug.medianWordHeight.toFixed(2)}</div>
              <div>alignment score: {spatialDocument.debug.alignment.score.toFixed(3)}</div>
              <div>row agg: {spatialDocument.debug.rowConfidenceAggregate.toFixed(3)}</div>
              <div>col agg: {spatialDocument.debug.columnConfidenceAggregate.toFixed(3)}</div>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">Missing spatial document.</p>
          )}
        </Section>

        <Section title="2. Region classification">
          {semanticParse?.debug.regionClassifications?.length ? (
            <ul className="text-xs space-y-2">
              {semanticParse.debug.regionClassifications.map((r) => (
                <li key={r.regionIndex} className="border-b border-border pb-2 last:border-0">
                  <div className="font-medium text-text-primary">
                    #{r.regionIndex} {r.regionType}{' '}
                    <span className="text-text-secondary font-normal">
                      (spatial {(r.spatialTableConfidence * 100).toFixed(0)}% · cls{' '}
                      {(r.classificationConfidence * 100).toFixed(0)}%)
                    </span>
                  </div>
                  {r.reasoning.length ? (
                    <ul className="list-disc pl-4 text-text-secondary mt-1">
                      {r.reasoning.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">No region classifications.</p>
          )}
          {semanticParse?.debug.rejectedRegions?.length ? (
            <div className="mt-2 text-xs text-red-800">
              <div className="font-medium">Rejected regions</div>
              <ul className="list-disc pl-4">
                {semanticParse.debug.rejectedRegions.map((rr, i) => (
                  <li key={i}>
                    #{rr.regionIndex}: {rr.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>

        <Section title="3. Semantic line items">
          {semanticParse?.lineItems?.length ? (
            <ul className="text-xs max-h-56 overflow-auto space-y-1">
              {semanticParse.lineItems.map((li) => (
                <li key={`${li.rowIndex}-${li.tableRegionIndex ?? 0}`}>
                  <button
                    type="button"
                    className={clsx(
                      'text-left w-full rounded px-1 py-0.5 hover:bg-gray-100',
                      selectedRowIndex === li.rowIndex && 'bg-blue-50 ring-1 ring-blue-200',
                    )}
                    onClick={() => setSelectedRowIndex(li.rowIndex)}
                  >
                    <span className="font-mono text-text-muted">R{li.rowIndex}</span>{' '}
                    {li.itemName?.slice(0, 60) || li.rawRowText?.slice(0, 60) || '—'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">No semantic line items.</p>
          )}
          <div className="mt-3 border-t border-border pt-3">
            <SemanticLineInspector
              line={lineForRow}
              repairsForRow={repairsForRow}
              rejectedSummaries={rejectedForRow}
            />
          </div>
        </Section>

        <Section title="4. GST propagation / validation">
          <GstDebugPanel
            gstPropagation={gstPropagation}
            gstSectionMarkers={gstSectionMarkers}
            debugPayload={debugPayload}
          />
        </Section>

        <Section title="5. Optimization repairs">
          <OptimizationTracePanel optimization={optimization} />
        </Section>

        <Section title="6. Constraint violations">
          <div className="text-xs space-y-2">
            <div>
              <div className="font-medium text-text-primary">Semantic</div>
              <ul className="list-disc pl-4 text-text-secondary max-h-24 overflow-auto">
                {(semanticParse?.lineItems ?? [])
                  .filter((l) => !l.validation.quantityRateAmountConsistent || l.validation.warnings.length)
                  .map((l) => (
                    <li key={l.rowIndex}>
                      R{l.rowIndex}: {!l.validation.quantityRateAmountConsistent ? 'qty/rate/amount mismatch · ' : ''}
                      {l.validation.warnings.join('; ') || '—'}
                    </li>
                  ))}
              </ul>
            </div>
            <div>
              <div className="font-medium text-text-primary">Optimizer</div>
              {optimization?.warnings?.length ? (
                <ul className="list-disc pl-4 text-amber-900">
                  {optimization.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-text-muted">No optimizer warnings.</p>
              )}
            </div>
          </div>
        </Section>

        <Section title="7. Benchmark / telemetry metrics">
          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-text-primary bg-gray-50 p-2 rounded border border-border max-h-48 overflow-auto">
            {JSON.stringify(
              telemetrySummary ?? learningSnapshot?.semanticMetrics ?? { note: 'no telemetry bundle passed' },
              null,
              2,
            )}
          </pre>
        </Section>

        <Section title="8. Parser versions">
          <ul className="text-xs font-mono space-y-1">
            <li>parserVersion: {meta.parserVersion}</li>
            <li>preprocessing: {meta.preprocessingVersion}</li>
            <li>spatial: {meta.spatialEngineVersion}</li>
            <li>semantic: {meta.semanticParserVersion}</li>
            <li>optimization: {meta.optimizationEngineVersion}</li>
            <li>GST: {meta.gstEngineVersion}</li>
          </ul>
        </Section>

        <Section title="9. Supplier fingerprints">
          <div className="text-xs font-mono space-y-2 break-all">
            <div>
              <span className="text-text-secondary">layoutFingerprint: </span>
              {learningSnapshot?.layoutFingerprint ?? '—'}
            </div>
            <div>
              <span className="text-text-secondary">spatialProfile: </span>
              {learningSnapshot?.spatialProfile
                ? JSON.stringify(learningSnapshot.spatialProfile)
                : '—'}
            </div>
            <div>
              <span className="text-text-secondary">debug.supplier_aware: </span>
              {debugPayload && 'supplier_aware' in debugPayload
                ? JSON.stringify((debugPayload as Record<string, unknown>)['supplier_aware'])
                : '—'}
            </div>
          </div>
        </Section>

        <Section title="Raw extracted JSON">
          <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-48 overflow-auto bg-gray-50 p-2 rounded border border-border">
            {JSON.stringify(indianExtract ?? { note: 'pass indianExtract prop for full extract' }, null, 2)}
          </pre>
        </Section>

        <Section title="Debug payload (API)">
          <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-48 overflow-auto bg-gray-50 p-2 rounded border border-border">
            {JSON.stringify(debugPayload ?? { note: 'no debugPayload' }, null, 2)}
          </pre>
        </Section>
      </div>
    </div>
  );
}

export { hitTestRowAt, hitTestWordAt } from './RegionOverlayLayer';
export type {
  InvoiceExtractionDebugViewerProps,
  OverlayToggles,
} from './invoiceExtractionDebugTypes';
export { DEFAULT_OVERLAY_TOGGLES } from './invoiceExtractionDebugTypes';
