/**
 * Detects whether closing stock v2 tables exist (migration 174).
 * Cached for the process lifetime so we are not hitting information_schema on every request.
 */

import { queryOne } from '@/lib/db';

let v2SchemaCache: boolean | null = null;

export async function hasClosingStockV2Schema(): Promise<boolean> {
  if (v2SchemaCache !== null) return v2SchemaCache;
  try {
    const row = await queryOne<{ e: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'closing_stock_snapshot_headers'
       ) AS e`
    );
    v2SchemaCache = !!row?.e;
    return v2SchemaCache;
  } catch {
    v2SchemaCache = false;
    return false;
  }
}

/** For tests or after running migrations without restart. */
export function resetClosingStockSchemaCache(): void {
  v2SchemaCache = null;
}
