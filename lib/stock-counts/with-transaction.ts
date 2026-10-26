import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { stockCountErrorResponse } from '@/lib/stock-counts/route-helpers';

/** Runs a stock write on one transaction and turns refusals into JSON responses. */
export async function inStockTransaction<T extends Record<string, unknown>>(
  work: (client: PoolClient) => Promise<T>,
  fallback: string,
  status = 200
): Promise<NextResponse> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return NextResponse.json(result, { status });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return stockCountErrorResponse(error, fallback);
  } finally {
    client.release();
  }
}
