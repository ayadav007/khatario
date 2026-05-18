import { queryOne } from '@/lib/db';
import { GSTIN_RE } from '@/lib/indian-gst-invoice-extract';

import { vendorIdentityFromSupplierJson } from '../learningAggregation/hashes';
import type {
  KnownLayoutProfileRecord,
  LayoutExtractionStrategy,
  LayoutRollupBrief,
  LayoutStrategyDecision,
} from './types';
import {
  layoutHighConfidenceAcceptanceMin,
  layoutMinSamplesForSignals,
} from './featureFlag';

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function loadLayoutRollupBrief(
  layoutFingerprint: string | null | undefined,
): Promise<LayoutRollupBrief | null> {
  const fp = layoutFingerprint?.trim();
  if (!fp) return null;
  try {
    const row = await queryOne<{
      acceptance_rate: unknown;
      correction_rate: unknown;
      total_documents: number;
    }>(
      `SELECT acceptance_rate, correction_rate, total_documents
         FROM invoice_layout_profiles
        WHERE layout_fingerprint = $1`,
      [fp],
    );
    if (!row) return null;
    return {
      acceptanceRate: parseNum(row.acceptance_rate),
      correctionRate: parseNum(row.correction_rate),
      totalDocuments: row.total_documents ?? 0,
    };
  } catch {
    return null;
  }
}

/** First 15-char GSTIN substring from OCR (deterministic scan). */
export function extractGstinHintFromOcr(ocrText: string): string | null {
  const norm = ocrText.replace(/\s+/g, '').toUpperCase();
  for (let i = 0; i + 15 <= norm.length; i++) {
    const slice = norm.slice(i, i + 15);
    if (GSTIN_RE.test(slice)) return slice;
  }
  return null;
}

/**
 * Priority: KNOWN_VENDOR → profile row → HIGH_CONFIDENCE rollups → GENERIC.
 */
export async function selectExtractionStrategy(params: {
  layoutFingerprint: string | null | undefined;
  gstinHintFromOcr: string | null | undefined;
  knownProfile: KnownLayoutProfileRecord | null;
  layoutRollup: LayoutRollupBrief | null;
}): Promise<LayoutStrategyDecision> {
  const fp = params.layoutFingerprint?.trim();
  const knownProfile = params.knownProfile;

  let strategy: LayoutExtractionStrategy = 'GENERIC';

  const gst = params.gstinHintFromOcr?.replace(/\s/g, '').toUpperCase() ?? null;
  if (gst && GSTIN_RE.test(gst) && fp) {
    try {
      const { vendorKey } = vendorIdentityFromSupplierJson({
        name: null,
        gstin: gst,
      });
      const vrow = await queryOne<{ known_layout_fingerprints: string[] | null }>(
        `SELECT known_layout_fingerprints FROM invoice_vendor_profiles WHERE vendor_key = $1`,
        [vendorKey],
      );
      const fps = vrow?.known_layout_fingerprints ?? [];
      if (fps.includes(fp)) strategy = 'KNOWN_VENDOR';
    } catch {
      /* optional rollup tables */
    }
  }

  if (strategy === 'GENERIC' && knownProfile && fp) {
    strategy =
      knownProfile.layoutExtractionStrategy !== 'GENERIC' ?
        knownProfile.layoutExtractionStrategy
      : 'KNOWN_LAYOUT';
  }

  if (strategy === 'GENERIC') {
    const roll = params.layoutRollup;
    const minS = layoutMinSamplesForSignals();
    const hi = layoutHighConfidenceAcceptanceMin();
    if (
      roll &&
      roll.totalDocuments >= minS &&
      roll.acceptanceRate != null &&
      roll.acceptanceRate >= hi
    ) {
      strategy = 'HIGH_CONFIDENCE_LAYOUT';
    }
  }

  return { strategy, knownProfile };
}
