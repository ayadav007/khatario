import { closePool, getPool } from '@/lib/db';

import { aggregateFieldLearning } from './aggregateFieldLearning';
import { aggregateLayoutProfiles } from './aggregateLayoutProfiles';
import { aggregateVendorProfiles } from './aggregateVendorProfiles';
import { invoiceExtractionAggregationEnabled } from './featureFlag';
import type { InvoiceLearningAggregationSummary } from './types';

function logStructured(payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...payload }));
}

export { aggregateLayoutProfiles } from './aggregateLayoutProfiles';
export { aggregateVendorProfiles } from './aggregateVendorProfiles';
export { aggregateFieldLearning } from './aggregateFieldLearning';
export { invoiceExtractionAggregationEnabled } from './featureFlag';
export type {
  AggregationChunkStats,
  InvoiceLearningAggregationSummary,
  LayoutProfileUpsertRow,
  VendorProfileUpsertRow,
  FieldLearningUpsertRow,
} from './types';

/**
 * Offline, deterministic full rebuild of rollup tables under a DB transaction (retry-safe / idempotent).
 * Guard with INVOICE_EXTRACTION_AGGREGATION=true outside this function when wiring cron.
 */
export async function runInvoiceLearningAggregationTransactional(): Promise<InvoiceLearningAggregationSummary> {
  const startedTotal = Date.now();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");

    const layout = await aggregateLayoutProfiles(client);
    const vendor = await aggregateVendorProfiles(client);
    const field = await aggregateFieldLearning(client);

    await client.query('COMMIT');

    const totalRowsProcessed =
      layout.rowsProcessed + vendor.rowsProcessed + field.rowsProcessed;
    const totalRowsWritten = layout.rowsWritten + vendor.rowsWritten + field.rowsWritten;
    const durationMs = Date.now() - startedTotal;

    logStructured({
      scope: 'invoice-learning-aggregation',
      msg: 'completed',
      totalRowsProcessed,
      totalRowsWritten,
      durationMs,
      layout,
      vendor,
      field,
    });

    return {
      enabled: true,
      chunks: [layout, vendor, field],
      totalRowsProcessed,
      totalRowsWritten,
      durationMs,
    };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback errors while handling primary failure */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Honors INVOICE_EXTRACTION_AGGREGATION flag; shuts down PG pool afterward for script use.
 */
export async function runInvoiceLearningAggregationCli(): Promise<InvoiceLearningAggregationSummary> {
  if (!invoiceExtractionAggregationEnabled()) {
    const durationMs = 0;
    const summary: InvoiceLearningAggregationSummary = {
      enabled: false,
      chunks: [],
      totalRowsProcessed: 0,
      totalRowsWritten: 0,
      durationMs,
    };
    logStructured({
      scope: 'invoice-learning-aggregation',
      msg: 'skipped_disabled',
      flag: 'INVOICE_EXTRACTION_AGGREGATION=false',
      durationMs,
    });
    await closePool();
    return summary;
  }

  try {
    return await runInvoiceLearningAggregationTransactional();
  } finally {
    await closePool();
  }
}
