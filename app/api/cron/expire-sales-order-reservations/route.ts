/**
 * Expire unpaid WhatsApp sales-order stock holds past TTL.
 * Call: GET /api/cron/expire-sales-order-reservations
 */
import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { getPool } from '@/lib/db';
import { expireWhatsAppUnpaidReservations } from '@/lib/stock/sales-order-reservations';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await expireWhatsAppUnpaidReservations(client);
    await client.query('COMMIT');
    return NextResponse.json(result);
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[cron expire-sales-order-reservations] failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    client.release();
  }
}
