import { queryRows } from '@/lib/db';

import { vendorIdentityFromSupplierJson } from '../learningAggregation/hashes';
import type { HistoricalConfidenceSignals } from './types';

export function emptyHistoricalConfidenceSignals(): HistoricalConfidenceSignals {
  return {
    layoutAcceptanceRate: null,
    layoutCorrectionRate: null,
    layoutAvgConfidence: null,
    layoutSampleSize: 0,
    vendorCorrectionRate: null,
    vendorAvgConfidence: null,
    vendorSampleSize: 0,
    fieldCorrectionRates: {},
  };
}

/**
 * Loads rollup priors used by the historical pillar (safe when migrations not applied).
 */
export async function loadHistoricalConfidenceSignalsFromDb(params: {
  layoutFingerprint: string | null | undefined;
  supplierName: string | null;
  supplierGstin: string | null;
}): Promise<HistoricalConfidenceSignals> {
  const out = emptyHistoricalConfidenceSignals();

  const fp = params.layoutFingerprint?.trim();
  const { vendorKey } = vendorIdentityFromSupplierJson({
    name: params.supplierName,
    gstin: params.supplierGstin,
  });

  try {
    if (fp) {
      const layoutRows = await queryRows<{
        acceptance_rate: unknown;
        correction_rate: unknown;
        avg_confidence: unknown;
        total_documents: number;
      }>(
        `SELECT acceptance_rate, correction_rate, avg_confidence, total_documents
           FROM invoice_layout_profiles
          WHERE layout_fingerprint = $1
          LIMIT 1`,
        [fp],
      );
      const lr = layoutRows[0];
      if (lr) {
        out.layoutAcceptanceRate = lr.acceptance_rate != null ? Number(lr.acceptance_rate) : null;
        out.layoutCorrectionRate = lr.correction_rate != null ? Number(lr.correction_rate) : null;
        out.layoutAvgConfidence = lr.avg_confidence != null ? Number(lr.avg_confidence) : null;
        out.layoutSampleSize = lr.total_documents ?? 0;
      }
    }

    const vendorRows = await queryRows<{
      avg_correction_rate: string | null;
      avg_confidence: string | null;
      total_documents: number;
    }>(
      `SELECT avg_correction_rate, avg_confidence, total_documents
         FROM invoice_vendor_profiles
        WHERE vendor_key = $1
        LIMIT 1`,
      [vendorKey],
    );
    const vr = vendorRows[0];
    if (vr) {
      out.vendorCorrectionRate =
        vr.avg_correction_rate != null ? Number(vr.avg_correction_rate) : null;
      out.vendorAvgConfidence = vr.avg_confidence != null ? Number(vr.avg_confidence) : null;
      out.vendorSampleSize = vr.total_documents ?? 0;
    }

    const fieldRows = await queryRows<{ field_name: string; correction_rate: unknown }>(
      `SELECT field_name, correction_rate
         FROM invoice_field_learning
        WHERE correction_rate IS NOT NULL
        ORDER BY field_name ASC
        LIMIT 500`,
    );
    const m: Record<string, number> = {};
    for (const r of fieldRows) {
      if (r.correction_rate == null) continue;
      const n = Number(r.correction_rate);
      if (Number.isFinite(n)) m[r.field_name] = n;
    }
    out.fieldCorrectionRates = m;
  } catch {
    /* tables may not exist on fresh installs */
  }

  return out;
}
