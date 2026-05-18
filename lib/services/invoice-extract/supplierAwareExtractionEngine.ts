/**
 * Deterministic supplier/layout-aware extraction context (telemetry + promoted configs + layout priors).
 * No ML — only versioned, explainable merges.
 */

import { queryRows } from '@/lib/db';
import type { AdaptiveConfigPatch } from './adaptiveConfigEngine';
import type { IgnoredAdaptiveRelease } from './supplierAdaptiveConfigResolver';
import { loadMergedApprovedAdaptivePatch } from './supplierAdaptiveConfigResolver';
import { computeLayoutPriors, type LayoutPriorApplication } from './layoutPriorEngine';
import {
  resolveExtractionProfile,
  type CorrectionTelemetryHint,
  type ResolvedExtractionProfile,
} from './extractionProfileResolver';
import { supplierHashFromGstin } from './supplierFingerprintEngine';
import type { InvoiceSpatialDocument } from './ocrSpatialParser';

export type { ResolvedExtractionProfile, CorrectionTelemetryHint } from './extractionProfileResolver';
export type { LayoutPriorApplication } from './layoutPriorEngine';

export interface SupplierAwareResolution {
  extractionProfile: ResolvedExtractionProfile;
  supplierHints: string[];
  appliedAdaptiveConfigs: string[];
  confidenceAdjustments: Record<string, unknown>;
  layoutBiases: LayoutPriorApplication;
  ignoredAdaptiveReleases: IgnoredAdaptiveRelease[];
  correctionHints: CorrectionTelemetryHint[];
}

export function supplierAwareExtractionEnabled(): boolean {
  const v = (process.env.SUPPLIER_AWARE_EXTRACTION ?? 'true').toLowerCase().trim();
  return v !== '0' && v !== 'false' && v !== 'no';
}

export function formatSupplierAwareHintBlock(lines: string[]): string {
  if (!lines.length) return '';
  const capped = lines.slice(0, 12);
  return ['--- Supplier-aware hints (deterministic config / telemetry; not ML) ---', ...capped].join('\n');
}

async function fetchCorrectionTelemetryHints(params: {
  businessId: string;
  supplierHash: string | null;
}): Promise<CorrectionTelemetryHint[]> {
  if (!params.supplierHash) return [];
  try {
    const rows = await queryRows<{ pattern_bucket: string; c: number }>(
      `SELECT
         CASE
           WHEN field_path ~ '^items\\[[0-9]+\\]\\.quantity' THEN 'items.quantity'
           WHEN field_path ~ '^items\\[[0-9]+\\]\\.(tax_rate|amount)' THEN 'items.tax_or_amount'
           WHEN field_path LIKE 'totals.%' THEN 'totals'
           WHEN field_path LIKE 'supplier.%' THEN 'supplier'
           ELSE 'other'
         END AS pattern_bucket,
         COUNT(*)::int AS c
       FROM invoice_correction_logs
       WHERE business_id = $1::uuid
         AND supplier_hash = $2
         AND created_at > NOW() - INTERVAL '365 days'
       GROUP BY 1
       HAVING COUNT(*) >= 2
       ORDER BY COUNT(*) DESC
       LIMIT 12`,
      [params.businessId, params.supplierHash],
    );
    return rows.map((r) => ({
      field_path_pattern: r.pattern_bucket,
      correction_events: r.c,
    }));
  } catch (e) {
    console.warn('[supplier-aware] correction telemetry load failed:', e);
    return [];
  }
}

function buildHintLinesFromPatch(patch: AdaptiveConfigPatch, correctionHints: CorrectionTelemetryHint[]): string[] {
  const lines: string[] = [];

  if (patch.header_synonyms && Object.keys(patch.header_synonyms).length) {
    for (const [canon, aliases] of Object.entries(patch.header_synonyms).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const al = (aliases ?? []).slice(0, 4).join(', ');
      if (al) lines.push(`Header synonyms for “${canon}”: ${al}`);
    }
  }

  if (patch.supplier_aliases && Object.keys(patch.supplier_aliases).length) {
    for (const [k, v] of Object.entries(patch.supplier_aliases).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`Alias token: ${k} → ${v}`);
    }
  }

  if (patch.preferred_price_mode) {
    lines.push(`Preferred price mode hint: ${patch.preferred_price_mode} (when extract is ambiguous).`);
  }

  const lp = patch.layout_preferences;
  if (lp && typeof lp === 'object') {
    const desc = lp.receipt_hint;
    if (typeof desc === 'string' && desc.trim()) lines.push(`Layout preference: ${desc.trim().slice(0, 160)}`);
    if (lp.gst_before_lines === true) lines.push('Layout preference: GST band often appears before line blocks.');
    if (lp.amount_inclusive_column === true) lines.push('Layout preference: “Value/Amount” column is often tax-inclusive.');
  }

  const gh = patch.gst_heuristics;
  if (gh && typeof gh === 'object' && gh.summary && typeof gh.summary === 'string') {
    lines.push(`GST heuristic (approved): ${String(gh.summary).slice(0, 140)}`);
  }

  for (const h of correctionHints) {
    if (h.correction_events >= 4) {
      lines.push(`Historical corrections: frequent edits on ${h.field_path_pattern} (${h.correction_events} in 365d).`);
    }
  }

  return lines.slice(0, 14);
}

function explainConfidenceAdjustments(args: {
  profile: ResolvedExtractionProfile;
  layoutPrior: LayoutPriorApplication;
  mergedPatch: AdaptiveConfigPatch;
}): Record<string, unknown> {
  return {
    semantic_relative_tolerance: args.profile.semanticValidation.relativeTolerance,
    semantic_absolute_tolerance: args.profile.semanticValidation.absoluteTolerance,
    numeric_max_qty_rate_pairs: args.profile.numericRepairSearch.maxQtyRatePairs,
    optimization_weight_deltas_vs_default: {
      line: args.profile.optimizationWeights.line,
      slab: args.profile.optimizationWeights.slab,
      invoice: args.profile.optimizationWeights.invoice,
      ocrConfidence: args.profile.optimizationWeights.ocrConfidence,
      regionConfidence: args.profile.optimizationWeights.regionConfidence,
    },
    layout_prior_labels: args.layoutPrior.labels,
    adaptive_threshold_overrides_present: Boolean(
      args.mergedPatch.thresholds && Object.keys(args.mergedPatch.thresholds).length,
    ),
  };
}

export async function resolveSupplierAwareExtractionContext(params: {
  businessId?: string | null;
  gstinHint: string | null;
  layoutFingerprint: string | null;
  spatialDocument: InvoiceSpatialDocument | null | undefined;
}): Promise<SupplierAwareResolution> {
  const supplierHash = supplierHashFromGstin(params.gstinHint);
  const layoutBiases = computeLayoutPriors({
    spatialDocument: params.spatialDocument,
    layoutFingerprint: params.layoutFingerprint,
  });

  const { mergedPatch, appliedReleaseVersions, ignored } = await loadMergedApprovedAdaptivePatch({
    businessId: params.businessId,
    supplierHash,
    layoutFingerprint: params.layoutFingerprint,
  });

  const correctionHints =
    params.businessId && supplierHash
      ? await fetchCorrectionTelemetryHints({ businessId: params.businessId, supplierHash })
      : [];

  const extractionProfile = resolveExtractionProfile({
    mergedAdaptivePatch: mergedPatch,
    layoutPrior: layoutBiases,
    correctionHints,
  });

  const supplierHints = buildHintLinesFromPatch(mergedPatch, correctionHints);
  const confidenceAdjustments = explainConfidenceAdjustments({
    profile: extractionProfile,
    layoutPrior: layoutBiases,
    mergedPatch: mergedPatch,
  });

  if ((process.env.SUPPLIER_AWARE_EXTRACTION_DEBUG ?? '').toLowerCase().trim() === 'true') {
    console.info('[supplier-aware]', {
      supplierHashPresent: Boolean(supplierHash),
      layoutPriorLabels: layoutBiases.labels,
      appliedReleases: appliedReleaseVersions,
      ignoredReleases: ignored,
      hintLineCount: supplierHints.length,
    });
  }

  return {
    extractionProfile,
    supplierHints,
    appliedAdaptiveConfigs: appliedReleaseVersions,
    confidenceAdjustments,
    layoutBiases,
    ignoredAdaptiveReleases: ignored,
    correctionHints,
  };
}
