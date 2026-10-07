import { getPool, queryOne, queryRows } from '@/lib/db';
import { approveEligiblePartnerCommissions } from '@/lib/partners/commission';
import { getPartnerProgramSettings } from '@/lib/partners/settings';

export function computeTdsAmount(params: {
  gross: number;
  tdsEnabled: boolean;
  tdsRatePercent: number;
  hasPan: boolean;
  noPanRatePercent?: number;
}): number {
  if (!params.tdsEnabled || params.gross <= 0) return 0;
  const rate = params.hasPan
    ? Math.max(0, params.tdsRatePercent)
    : Math.max(0, params.noPanRatePercent ?? Math.max(params.tdsRatePercent, 20));
  return Math.round(((params.gross * rate) / 100) * 100) / 100;
}

export async function listApprovedCommissionsForPayout(partnerId: string) {
  await approveEligiblePartnerCommissions(100).catch(() => 0);
  return queryRows<{
    id: string;
    business_id: string;
    business_name: string | null;
    sale_amount: string;
    commission_amount: string;
    eligible_at: string;
    created_at: string;
  }>(
    `SELECT c.id, c.business_id, b.name AS business_name,
            c.sale_amount, c.commission_amount, c.eligible_at, c.created_at
     FROM partner_commissions c
     LEFT JOIN businesses b ON b.id = c.business_id
     WHERE c.partner_id = $1 AND c.status = 'approved'
     ORDER BY c.eligible_at ASC`,
    [partnerId],
  );
}

export async function createPartnerPayout(params: {
  partnerId: string;
  commissionIds: string[];
  paymentReference?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
  adminId: string;
}): Promise<{
  payoutId: string;
  gross: number;
  tds: number;
  net: number;
}> {
  if (!params.commissionIds.length) {
    throw new Error('Select at least one approved commission');
  }

  const partner = await queryOne<{
    id: string;
    status: string;
    pan: string | null;
  }>(`SELECT id, status, pan FROM platform_partners WHERE id = $1`, [params.partnerId]);
  if (!partner || partner.status !== 'active') {
    throw new Error('Partner is not active');
  }

  const settings = await getPartnerProgramSettings();
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const commissionsRes = await client.query<{
      id: string;
      commission_amount: string;
      status: string;
    }>(
      `SELECT id, commission_amount, status
       FROM partner_commissions
       WHERE partner_id = $1
         AND id = ANY($2::uuid[])
       FOR UPDATE`,
      [params.partnerId, params.commissionIds],
    );

    if (commissionsRes.rows.length !== params.commissionIds.length) {
      throw new Error('One or more commissions were not found for this partner');
    }
    for (const row of commissionsRes.rows) {
      if (row.status !== 'approved') {
        throw new Error(`Commission ${row.id} is not approved`);
      }
    }

    const gross =
      Math.round(
        commissionsRes.rows.reduce((s, r) => s + Number(r.commission_amount), 0) * 100,
      ) / 100;

    const hasPan = Boolean(partner.pan?.trim());
    const tdsRate = hasPan
      ? settings.tds_rate_percent
      : Math.max(settings.tds_rate_percent, 20);
    const tds = computeTdsAmount({
      gross,
      tdsEnabled: settings.tds_enabled,
      tdsRatePercent: settings.tds_rate_percent,
      hasPan,
    });
    const net = Math.round((gross - tds) * 100) / 100;
    if (net < 0) throw new Error('Net payout cannot be negative');

    const payoutRes = await client.query<{ id: string }>(
      `INSERT INTO partner_payouts (
         partner_id, gross_amount, tds_amount, net_amount,
         tds_section, tds_rate_percent, status,
         payment_reference, payment_method, notes,
         paid_at, paid_by_admin_id
       ) VALUES ($1, $2, $3, $4, $5, $6, 'paid', $7, $8, $9, CURRENT_TIMESTAMP, $10)
       RETURNING id`,
      [
        params.partnerId,
        gross,
        tds,
        net,
        settings.tds_enabled ? settings.tds_section : null,
        settings.tds_enabled ? tdsRate : null,
        params.paymentReference?.trim() || null,
        params.paymentMethod?.trim() || 'bank_transfer',
        params.notes?.trim() || null,
        params.adminId,
      ],
    );
    const payoutId = payoutRes.rows[0].id;

    for (const row of commissionsRes.rows) {
      const amount = Number(row.commission_amount);
      const itemTds =
        gross > 0 ? Math.round(((amount / gross) * tds) * 100) / 100 : 0;
      await client.query(
        `INSERT INTO partner_payout_items (payout_id, commission_id, commission_amount, tds_amount)
         VALUES ($1, $2, $3, $4)`,
        [payoutId, row.id, amount, itemTds],
      );
      await client.query(
        `UPDATE partner_commissions
         SET status = 'paid', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [row.id],
      );
    }

    await client.query('COMMIT');
    return { payoutId, gross, tds, net };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listPartnerPayouts(partnerId: string) {
  return queryRows(
    `SELECT id, gross_amount, tds_amount, net_amount, tds_section, tds_rate_percent,
            status, payment_reference, payment_method, notes, paid_at, created_at
     FROM partner_payouts
     WHERE partner_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [partnerId],
  );
}

export async function listAllPayouts(limit = 100) {
  return queryRows(
    `SELECT p.id, p.partner_id, pp.name AS partner_name, pp.referral_code,
            p.gross_amount, p.tds_amount, p.net_amount, p.status,
            p.payment_reference, p.paid_at, p.created_at
     FROM partner_payouts p
     JOIN platform_partners pp ON pp.id = p.partner_id
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [limit],
  );
}

export async function getPartnerPayoutDetail(payoutId: string) {
  const payout = await queryOne(
    `SELECT p.*, pp.name AS partner_name, pp.email AS partner_email, pp.pan
     FROM partner_payouts p
     JOIN platform_partners pp ON pp.id = p.partner_id
     WHERE p.id = $1`,
    [payoutId],
  );
  if (!payout) return null;
  const items = await queryRows(
    `SELECT i.*, c.business_id, b.name AS business_name
     FROM partner_payout_items i
     JOIN partner_commissions c ON c.id = i.commission_id
     LEFT JOIN businesses b ON b.id = c.business_id
     WHERE i.payout_id = $1`,
    [payoutId],
  );
  return { payout, items };
}
