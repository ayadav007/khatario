import type { PoolClient } from 'pg';
import { queryOne } from '@/lib/db';

/**
 * What happens to short and damaged quantities when a Supplier Hub bill is received
 * (POST /api/invoices/[id]/convert-to-purchase). Stored in business_settings.settings.
 * - `keep`: everything billed goes into stock; the receipt records short/damaged for a
 *   purchase return the business raises later.
 * - `auto_return`: the receipt also raises that purchase return (debit note) to the supplier,
 *   so stock, supplier balance, ledger and GST move back together at once.
 */
export type ReceiptShortfallMode = 'keep' | 'auto_return';

export const RECEIPT_SHORTFALL_MODES: ReceiptShortfallMode[] = ['keep', 'auto_return'];

const KEY = 'receipt_shortfall_mode';

export function isReceiptShortfallMode(value: unknown): value is ReceiptShortfallMode {
  return typeof value === 'string' && (RECEIPT_SHORTFALL_MODES as string[]).includes(value);
}

export async function readReceiptShortfallMode(
  businessId: string,
  client?: PoolClient
): Promise<ReceiptShortfallMode> {
  const sql = `SELECT settings ->> $2 AS mode FROM business_settings WHERE business_id = $1`;
  const row = client
    ? (await client.query<{ mode: string | null }>(sql, [businessId, KEY])).rows[0]
    : await queryOne<{ mode: string | null }>(sql, [businessId, KEY]);
  return isReceiptShortfallMode(row?.mode) ? row!.mode as ReceiptShortfallMode : 'keep';
}

export async function saveReceiptShortfallMode(
  businessId: string,
  mode: ReceiptShortfallMode
): Promise<ReceiptShortfallMode> {
  await queryOne(
    `INSERT INTO business_settings (business_id, settings)
     VALUES ($1, jsonb_build_object($3::text, $2::text))
     ON CONFLICT (business_id) DO UPDATE
       SET settings = COALESCE(business_settings.settings, '{}'::jsonb)
                    || jsonb_build_object($3::text, $2::text),
           updated_at = CURRENT_TIMESTAMP`,
    [businessId, mode, KEY]
  );
  return mode;
}
