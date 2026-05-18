/**
 * Gate offline invoice learning aggregation cron / scripts.
 * Set INVOICE_EXTRACTION_AGGREGATION=true (exact) to enable.
 */
export function invoiceExtractionAggregationEnabled(): boolean {
  const v = (process.env.INVOICE_EXTRACTION_AGGREGATION ?? 'false').trim().toLowerCase();
  return v === 'true';
}
