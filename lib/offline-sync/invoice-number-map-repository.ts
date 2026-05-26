import type { PoolClient } from 'pg';
import { queryRows, queryOne } from '@/lib/db';

export interface OfflineInvoiceNumberMapRow {
  id: string;
  business_id: string;
  offline_reference_number: string;
  final_invoice_number: string;
  invoice_id: string;
  replay_log_id: string | null;
  device_id: string | null;
  created_at: Date;
}

export async function listInvoiceNumberMappings(
  businessId: string,
  limit = 50
): Promise<OfflineInvoiceNumberMapRow[]> {
  return queryRows<OfflineInvoiceNumberMapRow>(
    `
    SELECT * FROM offline_invoice_number_map
    WHERE business_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [businessId, limit]
  );
}

export async function findMappingByOfflineRef(
  client: PoolClient,
  businessId: string,
  offlineReferenceNumber: string
): Promise<OfflineInvoiceNumberMapRow | null> {
  const res = await client.query<OfflineInvoiceNumberMapRow>(
    `SELECT * FROM offline_invoice_number_map WHERE business_id = $1 AND offline_reference_number = $2 LIMIT 1`,
    [businessId, offlineReferenceNumber]
  );
  return res.rows[0] ?? null;
}

export async function countInvoiceMappings(businessId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM offline_invoice_number_map WHERE business_id = $1`,
    [businessId]
  );
  return Number(row?.count ?? 0);
}
