/**
 * One-off: diagnose payment state for a sales order (run: npx tsx scripts/debug-order-payment.ts SO-RINV-0003)
 */
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function main() {
  const orderNum = process.argv[2] || 'SO-RINV-0003';
  const { queryRows, queryOne, getPool } = await import('../lib/db');

  const order = await queryOne(
    `SELECT id, business_id, order_number, payment_status, status, grand_total::text,
            payment_reference, payment_method, ocr_status, whatsapp_conversation_id, created_at
     FROM sales_orders WHERE order_number = $1`,
    [orderNum]
  );

  console.log('--- sales_orders row ---');
  console.log(JSON.stringify(order, null, 2));

  if (!order) {
    console.log('No order found for', orderNum);
    await getPool().end();
    process.exit(1);
    return;
  }

  const o = order as Record<string, unknown>;

  const txs = await queryRows(
    `SELECT id, status, amount::text, provider, provider_payment_id, utr, created_at, raw_payload
     FROM payment_transactions WHERE order_id = $1 ORDER BY created_at`,
    [o.id]
  );

  console.log(`--- payment_transactions (${txs.length} rows) ---`);
  for (const t of txs) {
    const r = t as Record<string, unknown>;
    const raw = (r.raw_payload as Record<string, unknown>) || {};
    console.log(
      JSON.stringify(
        {
          id: r.id,
          status: r.status,
          amount: r.amount,
          provider: r.provider,
          provider_payment_id: r.provider_payment_id,
          utr: r.utr,
          provider_order_id: raw.provider_order_id,
          khatario_order_id: raw.khatario_order_id,
          created_at: r.created_at,
        },
        null,
        2
      )
    );
  }

  const events = await queryRows(
    `SELECT id, provider, left(idempotency_key, 24) as idem_prefix, created_at
     FROM payment_webhook_events
     WHERE business_id = $1
     ORDER BY created_at DESC
     LIMIT 15`,
    [o.business_id]
  );

  console.log('--- recent payment_webhook_events (up to 15) ---');
  console.log(JSON.stringify(events, null, 2));

  await getPool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
