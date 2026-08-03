import type { PoolClient } from 'pg';

function normalizeJobId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return id.length > 0 ? id : null;
}

/** Link a scan job to a saved purchase; mark completed only when purchase is final. */
export async function linkExtractionJobToPurchase(
  client: PoolClient,
  opts: {
    extractionJobId: unknown;
    purchaseId: string;
    businessId: string;
    purchaseStatus: 'draft' | 'final';
  }
): Promise<void> {
  const jobId = normalizeJobId(opts.extractionJobId);
  if (!jobId) return;

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM invoice_extraction_jobs WHERE id = $1 AND business_id = $2`,
    [jobId, opts.businessId]
  );
  if (existing.rows.length === 0) return;

  if (opts.purchaseStatus === 'final') {
    await client.query(
      `UPDATE invoice_extraction_jobs
          SET status = 'completed',
              purchase_id = $1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND business_id = $3`,
      [opts.purchaseId, jobId, opts.businessId]
    );
    return;
  }

  await client.query(
    `UPDATE invoice_extraction_jobs
        SET purchase_id = $1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND business_id = $3
        AND status IN ('processing', 'extracted', 'partial')`,
    [opts.purchaseId, jobId, opts.businessId]
  );
}

/** When a draft purchase is finalized, complete any linked scan job. */
export async function completeExtractionJobForFinalizedPurchase(
  client: PoolClient,
  opts: { purchaseId: string; businessId: string }
): Promise<void> {
  await client.query(
    `UPDATE invoice_extraction_jobs
        SET status = 'completed',
            updated_at = CURRENT_TIMESTAMP
      WHERE purchase_id = $1
        AND business_id = $2
        AND status IN ('processing', 'extracted', 'partial')`,
    [opts.purchaseId, opts.businessId]
  );
}

/** True when scan data is ready to import into the purchase form. */
export function extractionJobReadyForImport(status: string | null | undefined): boolean {
  return status === 'extracted' || status === 'completed';
}
