/**
 * Field-level correction audit trail from extraction review UI (deterministic paths).
 */

import { query as dbQuery } from '@/lib/db';
import type { ParserVersionMetadata } from './parserVersion';
import { supplierHashFromGstin } from './supplierFingerprintEngine';

export function extractionCorrectionLoggingEnabled(): boolean {
  const v = (process.env.INVOICE_CORRECTION_LOGGING ?? 'true').toLowerCase().trim();
  return v !== '0' && v !== 'false' && v !== 'no';
}

export interface CorrectionLogInsertRow {
  business_id: string;
  user_id: string | null;
  extraction_job_id: string | null;
  invoice_id?: string | null;
  supplier_hash: string | null;
  field_path: string;
  original_value: unknown;
  corrected_value: unknown;
  correction_type: string;
  parser_versions: ParserVersionMetadata;
}

function normPrimitive(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isFinite(v))
    return String(Math.round(v * 10000) / 10000);
  return String(v).trim();
}

function correctionBucket(fieldPath: string): string {
  if (fieldPath.startsWith('supplier.')) return 'supplier_field';
  if (fieldPath.startsWith('invoice.')) return 'invoice_field';
  if (fieldPath.startsWith('totals.')) return 'totals_field';
  if (fieldPath.startsWith('items[')) return 'item_field';
  return 'unknown_field';
}

const SUP_KEYS = ['name', 'gstin', 'address', 'state_code', 'phone', 'email'] as const;
const INV_KEYS = [
  'invoice_number',
  'invoice_date',
  'due_date',
  'place_of_supply',
  'reverse_charge',
] as const;
const ITEM_KEYS = [
  'item_name',
  'quantity',
  'unit_price',
  'amount',
  'tax_rate',
  'hsn_sac',
  'discount_percent',
  'discount_amount',
  'discount_on_tax_inclusive',
] as const;
const TOTAL_KEYS = [
  'subtotal',
  'tax_amount',
  'grand_total',
  'cgst_total',
  'sgst_total',
  'igst_total',
  'round_off',
] as const;

/**
 * Expand purchase-review shaped payloads into rows suitable for `invoice_correction_logs`.
 */
export function buildCorrectionLogsFromPurchaseReviewDelta(params: {
  businessId: string;
  userId: string | null;
  extractionJobId: string | null;
  invoiceId?: string | null;
  parserVersions: ParserVersionMetadata;
  before: { supplier?: unknown; invoice?: unknown; items?: unknown; totals?: unknown } | null | undefined;
  after: { supplier?: unknown; invoice?: unknown; items?: unknown; totals?: unknown } | null | undefined;
}): CorrectionLogInsertRow[] {
  const rows: CorrectionLogInsertRow[] = [];
  const bs = (params.before?.supplier ?? {}) as Record<string, unknown>;
  const as = (params.after?.supplier ?? {}) as Record<string, unknown>;
  const gstin = typeof as.gstin === 'string' ? as.gstin : typeof bs.gstin === 'string' ? bs.gstin : null;
  const supplier_hash = supplierHashFromGstin(gstin);

  for (const k of SUP_KEYS) {
    if (normPrimitive(bs[k]) !== normPrimitive(as[k])) {
      rows.push({
        business_id: params.businessId,
        user_id: params.userId,
        extraction_job_id: params.extractionJobId,
        invoice_id: params.invoiceId ?? null,
        supplier_hash,
        field_path: `supplier.${k}`,
        original_value: bs[k] ?? null,
        corrected_value: as[k] ?? null,
        correction_type: correctionBucket(`supplier.${k}`),
        parser_versions: params.parserVersions,
      });
    }
  }

  const bi = (params.before?.invoice ?? {}) as Record<string, unknown>;
  const ai = (params.after?.invoice ?? {}) as Record<string, unknown>;
  for (const k of INV_KEYS) {
    if (normPrimitive(bi[k]) !== normPrimitive(ai[k])) {
      rows.push({
        business_id: params.businessId,
        user_id: params.userId,
        extraction_job_id: params.extractionJobId,
        invoice_id: params.invoiceId ?? null,
        supplier_hash,
        field_path: `invoice.${k}`,
        original_value: bi[k] ?? null,
        corrected_value: ai[k] ?? null,
        correction_type: correctionBucket(`invoice.${k}`),
        parser_versions: params.parserVersions,
      });
    }
  }

  const bt = (params.before?.totals ?? {}) as Record<string, unknown>;
  const at = (params.after?.totals ?? {}) as Record<string, unknown>;
  for (const k of TOTAL_KEYS) {
    if (normPrimitive(bt[k]) !== normPrimitive(at[k])) {
      rows.push({
        business_id: params.businessId,
        user_id: params.userId,
        extraction_job_id: params.extractionJobId,
        invoice_id: params.invoiceId ?? null,
        supplier_hash,
        field_path: `totals.${k}`,
        original_value: bt[k] ?? null,
        corrected_value: at[k] ?? null,
        correction_type: correctionBucket(`totals.${k}`),
        parser_versions: params.parserVersions,
      });
    }
  }

  const bItems = Array.isArray(params.before?.items) ? params.before!.items : [];
  const aItems = Array.isArray(params.after?.items) ? params.after!.items : [];
  const n = Math.max(bItems.length, aItems.length);
  for (let i = 0; i < n; i++) {
    const rowB = (bItems[i] ?? {}) as Record<string, unknown>;
    const rowA = (aItems[i] ?? {}) as Record<string, unknown>;
    for (const k of ITEM_KEYS) {
      if (normPrimitive(rowB[k]) !== normPrimitive(rowA[k])) {
        rows.push({
          business_id: params.businessId,
          user_id: params.userId,
          extraction_job_id: params.extractionJobId,
          invoice_id: params.invoiceId ?? null,
          supplier_hash,
          field_path: `items[${i}].${k}`,
          original_value: rowB[k] ?? null,
          corrected_value: rowA[k] ?? null,
          correction_type: correctionBucket(`items[${i}].${k}`),
          parser_versions: params.parserVersions,
        });
      }
    }
  }

  return rows;
}

export async function insertInvoiceCorrectionLogs(rows: CorrectionLogInsertRow[]): Promise<number> {
  if (!extractionCorrectionLoggingEnabled() || rows.length === 0) return 0;
  let inserted = 0;
  try {
    for (const r of rows) {
      await dbQuery(
        `INSERT INTO invoice_correction_logs (
          business_id, user_id, extraction_job_id, invoice_id, supplier_hash,
          field_path, original_value, corrected_value, correction_type, parser_versions
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb)`,
        [
          r.business_id,
          r.user_id,
          r.extraction_job_id,
          r.invoice_id ?? null,
          r.supplier_hash,
          r.field_path,
          JSON.stringify(r.original_value ?? null),
          JSON.stringify(r.corrected_value ?? null),
          r.correction_type,
          JSON.stringify(r.parser_versions),
        ]
      );
      inserted++;
    }
  } catch (e) {
    console.warn('[invoice-correction-log] batch insert failed:', e);
  }
  return inserted;
}
