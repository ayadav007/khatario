/**
 * Trust signals for suppliers in the Supplier Hub directory and profile (migration 424):
 *   - GST verified: the registry lookup found the business's current GSTIN Active
 *   - district: from the GST registry address, else the business city
 *   - fill rate: share of ordered quantity confirmed on orders the supplier answered (90 days)
 *   - typical reply: median hours to answer an order or a connection request (90 days)
 *   - member since: when the business joined Khatario
 * Fill rate and reply time are shown only with at least MIN_SAMPLES answers, so one slow
 * day does not label a new supplier.
 */

import { query, queryOne, queryRows } from './db';
import { checkGstin } from './tax/gstin';
import type { SupplierTrust } from './suppliers-hub';

export type { SupplierTrust };

export const MIN_SAMPLES = 3;
const RECHECK_DAYS = 30;

/** SQL expression for a supplier's district, given `b` (businesses) and `d` (business_discovery). */
export const DISTRICT_SQL = `COALESCE(NULLIF(TRIM(d.gst_district), ''), NULLIF(TRIM(b.city), ''))`;

/**
 * Look the business's GSTIN up in the GST registry and store the result on its directory
 * listing. Skips when there is no valid GSTIN or the same GSTIN was checked recently. A
 * lookup that finds nothing leaves the last result in place.
 */
export async function refreshGstVerification(businessId: string, opts: { force?: boolean } = {}): Promise<void> {
  const row = await queryOne<{ gstin: string | null; verified_gstin: string | null; checked_at: string | null }>(
    `SELECT b.gstin, d.gst_verified_gstin AS verified_gstin, d.gst_checked_at AS checked_at
       FROM businesses b JOIN business_discovery d ON d.business_id = b.id
      WHERE b.id = $1`,
    [businessId]
  );
  if (!row) return;
  const check = checkGstin(row.gstin);
  if (!check.valid) return;
  const fresh =
    row.verified_gstin === check.gstin &&
    row.checked_at &&
    Date.now() - new Date(row.checked_at).getTime() < RECHECK_DAYS * 24 * 60 * 60 * 1000;
  if (fresh && !opts.force) return;

  const { fetchGstinRegistry } = await import('./gstin-registry');
  const found = await fetchGstinRegistry(check.gstin);
  if (!found) return;
  const rec = found.record;
  if (rec.gstin && String(rec.gstin).toUpperCase() !== check.gstin) return;
  await query(
    `UPDATE business_discovery SET
       gst_verified_gstin = $2, gst_checked_at = CURRENT_TIMESTAMP, gst_status = $3,
       gst_legal_name = $4, gst_district = $5
     WHERE business_id = $1`,
    [
      businessId,
      check.gstin,
      rec.sts ? String(rec.sts).slice(0, 40) : null,
      rec.lgnm || rec.tradeNam ? String(rec.lgnm || rec.tradeNam).slice(0, 300) : null,
      rec.pradr?.addr?.dst ? String(rec.pradr.addr.dst).slice(0, 120) : null,
    ]
  );
}

/** Trust signals for several businesses at once, keyed by business id. */
export async function trustForBusinesses(ids: string[]): Promise<Map<string, SupplierTrust>> {
  const out = new Map<string, SupplierTrust>();
  if (!ids.length) return out;
  const rows = await queryRows<{
    id: string;
    member_since: string | null;
    gst_status: string | null;
    gst_match: boolean | null;
    gst_legal_name: string | null;
    district: string | null;
    fill_rate: string | null;
    orders_answered: number | null;
    reply_hours: string | null;
    replies: number | null;
  }>(
    `
    WITH answered AS (
      SELECT o.vendor_business_id AS id, o.id AS order_id,
             EXTRACT(EPOCH FROM (COALESCE(o.confirmed_at, o.updated_at) - o.created_at)) / 3600 AS hours
        FROM supply_orders o
       WHERE o.vendor_business_id = ANY($1::uuid[])
         AND o.origin IN ('buyer', 'catalog', 'backorder')
         AND o.status IN ('confirmed', 'partial', 'declined', 'invoiced', 'dispatched', 'received')
         AND o.created_at > CURRENT_TIMESTAMP - INTERVAL '90 days'
    ),
    fill AS (
      SELECT a.id, SUM(LEAST(COALESCE(l.confirmed_qty, 0), l.qty)) / NULLIF(SUM(l.qty), 0) AS rate,
             COUNT(DISTINCT a.order_id)::int AS n
        FROM answered a JOIN supply_order_lines l ON l.order_id = a.order_id
       GROUP BY a.id
    ),
    replies AS (
      SELECT id, percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS median, COUNT(*)::int AS n
        FROM (
          SELECT id, hours FROM answered
          UNION ALL
          SELECT r.supplier_business_id, EXTRACT(EPOCH FROM (r.resolved_at - r.created_at)) / 3600
            FROM supplier_connection_requests r
           WHERE r.supplier_business_id = ANY($1::uuid[])
             AND r.status IN ('accepted', 'declined') AND r.resolved_at IS NOT NULL
             AND r.created_at > CURRENT_TIMESTAMP - INTERVAL '90 days'
        ) x
       GROUP BY id
    )
    SELECT b.id, b.created_at AS member_since, d.gst_status,
           (d.gst_verified_gstin IS NOT NULL AND d.gst_verified_gstin = UPPER(b.gstin)) AS gst_match,
           d.gst_legal_name, ${DISTRICT_SQL} AS district,
           fill.rate AS fill_rate, fill.n AS orders_answered, replies.median AS reply_hours, replies.n AS replies
      FROM businesses b
      LEFT JOIN business_discovery d ON d.business_id = b.id
      LEFT JOIN fill ON fill.id = b.id
      LEFT JOIN replies ON replies.id = b.id
     WHERE b.id = ANY($1::uuid[])
    `,
    [ids]
  );
  for (const r of rows) {
    const verified = !!r.gst_match && String(r.gst_status || '').trim().toLowerCase() === 'active';
    const answered = r.orders_answered ?? 0;
    out.set(r.id, {
      gst_verified: verified,
      gst_legal_name: verified ? r.gst_legal_name : null,
      district: r.district,
      fill_rate: answered >= MIN_SAMPLES && r.fill_rate != null ? Math.round(Number(r.fill_rate) * 100) / 100 : null,
      orders_answered: answered,
      reply_hours: (r.replies ?? 0) >= MIN_SAMPLES && r.reply_hours != null ? Math.round(Number(r.reply_hours) * 10) / 10 : null,
      member_since: r.member_since ? new Date(r.member_since).toISOString() : null,
    });
  }
  return out;
}
