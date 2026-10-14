import type { PoolClient } from 'pg';

/**
 * COD remittance: cash the courier (or the shop's own rider) collected on delivery and has to pay
 * over. Lists delivered COD parcels not yet matched to a remittance, and records a remittance
 * against the parcels it covers; any shortfall is kept as deductions (courier COD fees, etc).
 */

type Db = Pick<PoolClient, 'query'>;

export const REMITTANCE_SOURCES = ['shiprocket', 'courier', 'own_rider', 'local_app'] as const;
export type RemittanceSource = (typeof REMITTANCE_SOURCES)[number];

export class CodRemittanceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CodRemittanceError';
  }
}

export type OpenCodParcel = {
  id: string;
  order_number: string;
  seq: number;
  method: RemittanceSource;
  partner_name: string | null;
  rider_name: string | null;
  awb: string | null;
  buyer_name: string | null;
  cod_amount: number;
  delivered_at: string | null;
};

/** Delivered COD parcels whose cash has not reached the shop yet. */
export async function listOpenCod(db: Db, businessId: string, branchIds: string[] | null): Promise<OpenCodParcel[]> {
  const r = await db.query<OpenCodParcel>(
    `SELECT f.id, COALESCE(so.order_number, s.order_number, i.invoice_number, left(f.id::text, 8)) AS order_number,
            f.seq, f.method, f.partner_name, f.rider_name, f.awb, f.buyer_name,
            f.cod_amount::float8 AS cod_amount, f.delivered_at
       FROM order_fulfilments f
       LEFT JOIN store_orders so ON so.id = f.store_order_id
       LEFT JOIN sales_orders s ON s.id = f.sales_order_id
       LEFT JOIN invoices i ON i.id = f.invoice_id
      WHERE f.business_id = $1
        AND ($2::uuid[] IS NULL OR f.branch_id IS NULL OR f.branch_id = ANY($2::uuid[]))
        AND f.cod_amount > 0
        AND f.cod_remittance_id IS NULL
        AND f.status = 'delivered'
        AND f.method = ANY($3::varchar[])
      ORDER BY f.delivered_at NULLS LAST, f.created_at
      LIMIT 500`,
    [businessId, branchIds, REMITTANCE_SOURCES],
  );
  return r.rows;
}

export async function listRemittances(db: Db, businessId: string, limit = 50) {
  const r = await db.query(
    `SELECT c.id, c.source, c.partner_name, c.reference, c.remitted_on::text AS remitted_on,
            c.expected_amount::float8 AS expected_amount, c.received_amount::float8 AS received_amount,
            c.deductions::float8 AS deductions, c.notes,
            (SELECT COUNT(*)::int FROM order_fulfilments f WHERE f.cod_remittance_id = c.id) AS parcels
       FROM cod_remittances c
      WHERE c.business_id = $1
      ORDER BY c.remitted_on DESC, c.created_at DESC
      LIMIT $2`,
    [businessId, limit],
  );
  return r.rows;
}

export async function recordRemittance(
  client: PoolClient,
  p: {
    businessId: string;
    userId: string;
    source: RemittanceSource;
    partnerName?: string | null;
    reference?: string | null;
    remittedOn: string;
    receivedAmount: number;
    fulfilmentIds: string[];
    notes?: string | null;
  },
): Promise<{ id: string; expected: number; deductions: number }> {
  const ids = [...new Set(p.fulfilmentIds)];
  if (ids.length === 0) throw new CodRemittanceError(400, 'Pick the parcels this payment covers');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.remittedOn)) throw new CodRemittanceError(400, 'Enter the date the money came in');
  const received = Math.round(Number(p.receivedAmount) * 100) / 100;
  if (!Number.isFinite(received) || received < 0) throw new CodRemittanceError(400, 'Enter the amount received');

  const parcels = await client.query<{ id: string; cod: number }>(
    `SELECT id, cod_amount::float8 AS cod FROM order_fulfilments
      WHERE business_id = $1 AND id = ANY($2::uuid[])
        AND cod_amount > 0 AND cod_remittance_id IS NULL AND status = 'delivered'
      FOR UPDATE`,
    [p.businessId, ids],
  );
  if (parcels.rows.length !== ids.length) {
    throw new CodRemittanceError(409, 'Some parcels are not delivered COD parcels waiting for cash, or were already matched');
  }
  const expected = Math.round(parcels.rows.reduce((s, r) => s + Number(r.cod), 0) * 100) / 100;
  if (received > expected + 0.005) {
    throw new CodRemittanceError(400, `Received ₹${received} is more than the ₹${expected} collected on these parcels`);
  }
  const deductions = Math.round((expected - received) * 100) / 100;

  const ins = await client.query<{ id: string }>(
    `INSERT INTO cod_remittances
       (business_id, source, partner_name, reference, remitted_on, expected_amount, received_amount, deductions, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      p.businessId,
      p.source,
      p.partnerName?.trim().slice(0, 100) || null,
      p.reference?.trim().slice(0, 100) || null,
      p.remittedOn,
      expected,
      received,
      deductions,
      p.notes?.trim().slice(0, 500) || null,
      p.userId,
    ],
  );
  const id = ins.rows[0].id;
  await client.query(
    `UPDATE order_fulfilments
        SET cod_remittance_id = $3, cod_collected_at = COALESCE(cod_collected_at, NOW()), updated_at = NOW()
      WHERE business_id = $1 AND id = ANY($2::uuid[])`,
    [p.businessId, ids, id],
  );
  return { id, expected, deductions };
}
