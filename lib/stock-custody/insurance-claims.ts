import type { PoolClient } from 'pg';
import { accountIdByCode, insertVoucherLines, round2 } from '@/lib/accounting/voucher-posting';
import { GodownStockError } from '@/lib/inventory/godown-stock';

/**
 * Insurance claim for stock lost or damaged. The loss is already written off (an inventory
 * adjustment charged to Stock Loss, 5106). Lodging records the claim; admitting moves the
 * admitted amount from the loss to Insurance Claims Receivable (1145); settling receives it into
 * a bank or cash account, any short settlement going back to the loss; rejecting an admitted
 * claim reverses the receivable.
 */
export const CLAIM_CAUSES = ['theft', 'fire', 'flood', 'transit', 'damage', 'other'] as const;
type Queryable = Pick<PoolClient, 'query'>;

const LOSS_CODES = ['5106', '5201'];

async function account(client: Queryable, businessId: string, codes: string[], label: string): Promise<string> {
  for (const c of codes) {
    const id = await accountIdByCode(client as PoolClient, businessId, c);
    if (id) return id;
  }
  throw new GodownStockError(`${label} account (${codes.join(' / ')}) is not set up; run migration 416`, 500);
}

export interface LodgeClaimInput {
  lossDate: string;
  cause: (typeof CLAIM_CAUSES)[number];
  insurer: string;
  policyNumber?: string | null;
  firNumber?: string | null;
  firDate?: string | null;
  surveyor?: string | null;
  claimedAmount: number;
  adjustmentIds?: string[];
  branchId?: string | null;
  notes?: string | null;
}

export async function lodgeClaim(client: PoolClient, businessId: string, input: LodgeClaimInput, userId: string | null): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.lossDate || '')) throw new GodownStockError('Date of loss is required');
  if (!CLAIM_CAUSES.includes(input.cause)) throw new GodownStockError('Choose the cause of loss');
  if (!String(input.insurer || '').trim()) throw new GodownStockError('Name the insurer');
  const claimed = round2(Number(input.claimedAmount) || 0);
  if (claimed <= 0) throw new GodownStockError('Enter the amount claimed');
  if (input.cause === 'theft' && !String(input.firNumber || '').trim()) {
    throw new GodownStockError('A theft claim needs the FIR number');
  }
  const adjIds = [...new Set(input.adjustmentIds || [])];
  let lossValue = 0;
  if (adjIds.length) {
    const a = await client.query(
      `SELECT id, ABS(COALESCE(value_change, 0))::float AS v FROM inventory_adjustments
        WHERE business_id = $1 AND id = ANY($2::uuid[]) AND direction = 'DECREASE'`,
      [businessId, adjIds]
    );
    if (a.rows.length !== adjIds.length) throw new GodownStockError('Link only write-offs of this business', 404);
    lossValue = round2(a.rows.reduce((s: number, r: any) => s + r.v, 0));
  }
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('insurance_claim:' || $1::text))`, [businessId]);
  const n = await client.query(`SELECT COUNT(*)::int + 1 AS n FROM insurance_claims WHERE business_id = $1`, [businessId]);
  const r = await client.query(
    `INSERT INTO insurance_claims (business_id, claim_number, branch_id, loss_date, cause, insurer, policy_number, fir_number, fir_date,
       surveyor, loss_value, claimed_amount, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [businessId, `CLM-${String(n.rows[0].n).padStart(4, '0')}`, input.branchId || null, input.lossDate, input.cause, input.insurer.trim(),
     input.policyNumber || null, input.firNumber || null, input.firDate || null, input.surveyor || null, lossValue, claimed, input.notes || null, userId]
  );
  for (const id of adjIds) {
    await client.query(`INSERT INTO insurance_claim_adjustments (claim_id, adjustment_id) VALUES ($1, $2)`, [r.rows[0].id, id]);
  }
  return r.rows[0].id;
}

export type ClaimAction =
  | { action: 'admit'; amount: number; date: string }
  | { action: 'settle'; amount: number; date: string; account_id: string }
  | { action: 'reject'; date: string; notes?: string | null };

export async function updateClaim(client: PoolClient, businessId: string, claimId: string, a: ClaimAction): Promise<void> {
  const r = await client.query(`SELECT *, loss_date::text AS loss_on FROM insurance_claims WHERE id = $1 AND business_id = $2 FOR UPDATE`, [claimId, businessId]);
  const claim = r.rows[0];
  if (!claim) throw new GodownStockError('Claim not found', 404);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) throw new GodownStockError('Date is required');
  if (a.date < claim.loss_on) {
    throw new GodownStockError('The date cannot be before the loss');
  }
  const receivable = await account(client, businessId, ['1145'], 'Insurance Claims Receivable');
  const loss = await account(client, businessId, LOSS_CODES, 'Stock Loss');
  const post = (suffix: string, lines: Array<{ accountId: string; debit: number; credit: number; narration: string }>) =>
    insertVoucherLines(client, {
      businessId,
      branchId: claim.branch_id,
      voucherId: claimId,
      voucherType: `insurance_claim_${suffix}`,
      entryDate: a.date,
      reference: claim.claim_number,
      lines,
    });

  if (a.action === 'admit') {
    if (claim.status !== 'lodged') throw new GodownStockError(`A ${claim.status} claim cannot be admitted`, 409);
    const amount = round2(Number(a.amount) || 0);
    if (amount <= 0 || amount > Number(claim.claimed_amount)) throw new GodownStockError('Admitted amount must be between 0 and the amount claimed');
    const label = `Insurance claim ${claim.claim_number} admitted by ${claim.insurer}`;
    await post('admit', [
      { accountId: receivable, debit: amount, credit: 0, narration: label },
      { accountId: loss, debit: 0, credit: amount, narration: label },
    ]);
    await client.query(
      `UPDATE insurance_claims SET status = 'admitted', admitted_amount = $2, admitted_on = $3, updated_at = NOW() WHERE id = $1`,
      [claimId, amount, a.date]
    );
    return;
  }

  if (a.action === 'settle') {
    if (claim.status !== 'admitted') throw new GodownStockError('Admit the claim before recording the settlement', 409);
    const amount = round2(Number(a.amount) || 0);
    const admitted = Number(claim.admitted_amount);
    if (amount < 0 || amount > admitted) throw new GodownStockError(`Settlement must be between 0 and the admitted ${admitted}`);
    const bank = await client.query(
      `SELECT id FROM accounts WHERE id = $1 AND business_id = $2 AND account_type = 'asset'`,
      [a.account_id, businessId]
    );
    if (!bank.rows[0]) throw new GodownStockError('Choose the bank or cash account the money came into', 404);
    const short = round2(admitted - amount);
    const label = `Insurance claim ${claim.claim_number} settled by ${claim.insurer}`;
    const lines = [
      ...(amount > 0 ? [{ accountId: bank.rows[0].id, debit: amount, credit: 0, narration: label }] : []),
      ...(short > 0 ? [{ accountId: loss, debit: short, credit: 0, narration: `${label}: short by ${short}` }] : []),
      { accountId: receivable, debit: 0, credit: admitted, narration: label },
    ];
    await post('settle', lines);
    await client.query(
      `UPDATE insurance_claims SET status = 'settled', settled_amount = $2, settled_on = $3, updated_at = NOW() WHERE id = $1`,
      [claimId, amount, a.date]
    );
    return;
  }

  if (a.action === 'reject') {
    if (claim.status !== 'lodged' && claim.status !== 'admitted') throw new GodownStockError(`A ${claim.status} claim cannot be rejected`, 409);
    if (claim.status === 'admitted') {
      const admitted = Number(claim.admitted_amount);
      const label = `Insurance claim ${claim.claim_number} rejected by ${claim.insurer}`;
      await post('reject', [
        { accountId: loss, debit: admitted, credit: 0, narration: label },
        { accountId: receivable, debit: 0, credit: admitted, narration: label },
      ]);
    }
    await client.query(
      `UPDATE insurance_claims SET status = 'rejected', notes = COALESCE($2, notes), updated_at = NOW() WHERE id = $1`,
      [claimId, a.notes || null]
    );
    return;
  }
  throw new GodownStockError('Unknown action');
}

export async function listClaims(db: Queryable, businessId: string): Promise<any[]> {
  const r = await db.query(
    `SELECT c.*, c.loss_date::text AS loss_date, c.fir_date::text AS fir_date, c.admitted_on::text AS admitted_on,
            c.settled_on::text AS settled_on,
            COALESCE((SELECT json_agg(json_build_object('id', ia.id, 'number', ia.adjustment_number, 'item', i.name,
                        'qty', ABS(ia.quantity_change), 'value', ABS(COALESCE(ia.value_change, 0))))
                        FROM insurance_claim_adjustments x
                        JOIN inventory_adjustments ia ON ia.id = x.adjustment_id
                        JOIN items i ON i.id = ia.item_id
                       WHERE x.claim_id = c.id), '[]') AS write_offs
       FROM insurance_claims c WHERE c.business_id = $1 ORDER BY c.loss_date DESC, c.claim_number DESC`,
    [businessId]
  );
  return r.rows;
}
