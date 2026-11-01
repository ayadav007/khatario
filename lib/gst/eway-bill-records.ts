import type { PoolClient } from 'pg';
import {
  canCancel,
  canExtend,
  effectiveEwayStatus,
  EwayBillInputError,
  extendedValidUntil,
  hoursToExpiry,
  type EwaySourceType,
  type ParsedEwayBill,
} from '@/lib/gst/eway-bills';

type Queryable = Pick<PoolClient, 'query'>;

/** Table and date column of each document an e-way bill can hang on. */
const SOURCES: Partial<Record<EwaySourceType, { table: string; legacy?: { number: string; date?: string } }>> = {
  invoice: { table: 'invoices', legacy: { number: 'eway_bill_number', date: 'eway_bill_date' } },
  delivery_challan: { table: 'delivery_challans', legacy: { number: 'e_way_bill_number' } },
  stock_transfer: { table: 'stock_transfers' },
  purchase: { table: 'purchases' },
  purchase_return: { table: 'purchase_returns' },
  credit_note: { table: 'credit_notes' },
};

async function assertSource(db: Queryable, businessId: string, type: EwaySourceType, id: string | null) {
  if (type === 'other') return;
  if (!id) throw new EwayBillInputError('Link the e-way bill to its document');
  const src = SOURCES[type];
  if (!src) throw new EwayBillInputError('Invalid source type');
  const r = await db.query(`SELECT 1 FROM ${src.table} WHERE id = $1 AND business_id = $2`, [id, businessId]);
  if (!r.rows[0]) throw new EwayBillInputError('Linked document not found', 404);
}

export interface EwayBillView {
  id: string;
  source_type: EwaySourceType;
  source_id: string | null;
  source_number: string | null;
  direction: 'outward' | 'inward';
  ewb_number: string;
  doc_type: string;
  sub_supply_type: string;
  from_gstin: string | null;
  to_gstin: string | null;
  from_pincode: string | null;
  to_pincode: string | null;
  distance_km: number;
  is_odc: boolean;
  goods_value: number;
  generated_at: string;
  valid_until: string | null;
  stored_status: string;
  status: string;
  hours_to_expiry: number | null;
  can_extend: boolean;
  can_cancel: boolean;
  extension_count: number;
  vehicle_number: string | null;
  transporter_name: string | null;
  notes: string | null;
}

const SELECT_VIEW = `
  SELECT eb.*, v.vehicle_number, v.transporter_name,
         COALESCE(inv.invoice_number, dc.challan_number, st.transfer_number, pu.bill_number) AS source_number
    FROM eway_bills eb
    LEFT JOIN LATERAL (
      SELECT vehicle_number, transporter_name FROM eway_bill_vehicles
       WHERE eway_bill_id = eb.id ORDER BY created_at DESC LIMIT 1
    ) v ON true
    LEFT JOIN invoices inv ON eb.source_type = 'invoice' AND inv.id = eb.source_id
    LEFT JOIN delivery_challans dc ON eb.source_type = 'delivery_challan' AND dc.id = eb.source_id
    LEFT JOIN stock_transfers st ON eb.source_type = 'stock_transfer' AND st.id = eb.source_id
    LEFT JOIN purchases pu ON eb.source_type = 'purchase' AND pu.id = eb.source_id`;

function toView(r: any, now = new Date()): EwayBillView {
  const validUntil = r.valid_until ? new Date(r.valid_until) : null;
  const status = effectiveEwayStatus(r.status, validUntil, now);
  return {
    id: r.id,
    source_type: r.source_type,
    source_id: r.source_id,
    source_number: r.source_number ?? null,
    direction: r.direction,
    ewb_number: r.ewb_number,
    doc_type: r.doc_type,
    sub_supply_type: r.sub_supply_type,
    from_gstin: r.from_gstin,
    to_gstin: r.to_gstin,
    from_pincode: r.from_pincode,
    to_pincode: r.to_pincode,
    distance_km: Number(r.distance_km),
    is_odc: !!r.is_odc,
    goods_value: Number(r.goods_value),
    generated_at: new Date(r.generated_at).toISOString(),
    valid_until: validUntil ? validUntil.toISOString() : null,
    stored_status: r.status,
    status,
    hours_to_expiry: status === 'active' || status === 'expired' ? hoursToExpiry(validUntil, now) : null,
    can_extend: (status === 'active' || status === 'expired') && canExtend(validUntil, now),
    can_cancel: r.status === 'active' && canCancel(new Date(r.generated_at), now),
    extension_count: Number(r.extension_count) || 0,
    vehicle_number: r.vehicle_number ?? null,
    transporter_name: r.transporter_name ?? null,
    notes: r.notes ?? null,
  };
}

export async function getEwayBill(db: Queryable, businessId: string, id: string): Promise<EwayBillView | null> {
  const r = await db.query(`${SELECT_VIEW} WHERE eb.id = $1 AND eb.business_id = $2`, [id, businessId]);
  return r.rows[0] ? toView(r.rows[0]) : null;
}

export async function listEwayBills(
  db: Queryable,
  businessId: string,
  f: { sourceType?: string | null; sourceId?: string | null; status?: string | null; expiringWithinHours?: number | null; limit?: number }
): Promise<EwayBillView[]> {
  const r = await db.query(
    `${SELECT_VIEW}
      WHERE eb.business_id = $1
        AND ($2::text IS NULL OR eb.source_type = $2)
        AND ($3::uuid IS NULL OR eb.source_id = $3)
        AND ($4::numeric IS NULL OR (eb.status = 'active' AND eb.valid_until <= NOW() + ($4::numeric * INTERVAL '1 hour')))
      ORDER BY eb.generated_at DESC
      LIMIT $5`,
    [businessId, f.sourceType || null, f.sourceId || null, f.expiringWithinHours ?? null, Math.min(f.limit ?? 200, 500)]
  );
  const rows = r.rows.map((x: any) => toView(x));
  return f.status ? rows.filter((x) => x.status === f.status) : rows;
}

/** Records an e-way bill and copies its number onto the document's own e-way bill field. */
export async function createEwayBill(
  client: PoolClient,
  businessId: string,
  p: ParsedEwayBill,
  userId: string | null
): Promise<EwayBillView> {
  await assertSource(client, businessId, p.source_type, p.source_id);
  const ins = await client.query(
    `INSERT INTO eway_bills (
       business_id, source_type, source_id, direction, ewb_number, doc_type, sub_supply_type,
       from_gstin, to_gstin, from_pincode, to_pincode, distance_km, is_odc, goods_value,
       generated_at, valid_until, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      businessId, p.source_type, p.source_id, p.direction, p.ewb_number, p.doc_type, p.sub_supply_type,
      p.from_gstin, p.to_gstin, p.from_pincode, p.to_pincode, p.distance_km, p.is_odc, p.goods_value,
      p.generated, p.valid_until, p.notes, userId,
    ]
  );
  const id = ins.rows[0].id as string;
  if (p.vehicle_number || p.transporter_name || p.transporter_gstin) {
    await client.query(
      `INSERT INTO eway_bill_vehicles (eway_bill_id, transport_mode, vehicle_number, transporter_name, transporter_gstin, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Initial', $6)`,
      [id, p.transport_mode, p.vehicle_number, p.transporter_name, p.transporter_gstin, userId]
    );
  }
  const legacy = SOURCES[p.source_type]?.legacy;
  if (legacy && p.source_id) {
    const table = SOURCES[p.source_type]!.table;
    const dateSet = legacy.date ? `, ${legacy.date} = $4::date` : '';
    await client.query(
      `UPDATE ${table} SET ${legacy.number} = $3${dateSet}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2`,
      legacy.date
        ? [p.source_id, businessId, p.ewb_number, p.generated.toISOString().slice(0, 10)]
        : [p.source_id, businessId, p.ewb_number]
    );
  }
  return (await getEwayBill(client, businessId, id)) as EwayBillView;
}

export type EwayBillAction =
  | { action: 'cancel'; reason?: string }
  | { action: 'reject'; reason?: string }
  | { action: 'close' }
  | { action: 'extend'; remaining_km: number; reason?: string }
  | {
      action: 'vehicle';
      vehicle_number?: string;
      transporter_name?: string;
      transporter_gstin?: string;
      transport_mode?: 'road' | 'rail' | 'air' | 'ship';
      reason?: string;
    };

/** Cancel, reject, close, extend, or update Part B (vehicle). */
export async function updateEwayBill(
  client: PoolClient,
  businessId: string,
  id: string,
  a: EwayBillAction,
  userId: string | null,
  now = new Date()
): Promise<EwayBillView> {
  const r = await client.query(`SELECT * FROM eway_bills WHERE id = $1 AND business_id = $2 FOR UPDATE`, [id, businessId]);
  const row = r.rows[0];
  if (!row) throw new EwayBillInputError('E-way bill not found', 404);
  const validUntil = row.valid_until ? new Date(row.valid_until) : null;
  const open = row.status === 'active';

  switch (a.action) {
    case 'cancel':
      if (!open) throw new EwayBillInputError(`A ${row.status} e-way bill cannot be cancelled`, 409);
      if (!canCancel(new Date(row.generated_at), now)) {
        throw new EwayBillInputError('An e-way bill can only be cancelled within 24 hours of generation', 409);
      }
      await client.query(
        `UPDATE eway_bills SET status = 'cancelled', cancelled_at = $3, notes = COALESCE($4, notes), updated_at = NOW()
          WHERE id = $1 AND business_id = $2`,
        [id, businessId, now, a.reason || null]
      );
      break;
    case 'reject':
      if (!open) throw new EwayBillInputError(`A ${row.status} e-way bill cannot be rejected`, 409);
      await client.query(
        `UPDATE eway_bills SET status = 'rejected', rejected_at = $3, notes = COALESCE($4, notes), updated_at = NOW()
          WHERE id = $1 AND business_id = $2`,
        [id, businessId, now, a.reason || null]
      );
      break;
    case 'close':
      if (!open) throw new EwayBillInputError(`A ${row.status} e-way bill cannot be closed`, 409);
      await client.query(
        `UPDATE eway_bills SET status = 'closed', closed_at = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2`,
        [id, businessId, now]
      );
      break;
    case 'extend': {
      if (!open) throw new EwayBillInputError(`A ${row.status} e-way bill cannot be extended`, 409);
      if (!canExtend(validUntil, now)) {
        throw new EwayBillInputError('Validity can only be extended from 8 hours before expiry to 8 hours after it', 409);
      }
      const km = Number(a.remaining_km);
      if (!Number.isFinite(km) || km <= 0 || km > 4000) throw new EwayBillInputError('Enter the distance still to go');
      const next = extendedValidUntil(validUntil as Date, km, !!row.is_odc);
      await client.query(
        `UPDATE eway_bills SET valid_until = $3, extension_count = extension_count + 1, updated_at = NOW()
          WHERE id = $1 AND business_id = $2`,
        [id, businessId, next]
      );
      break;
    }
    case 'vehicle': {
      if (!open) throw new EwayBillInputError(`A ${row.status} e-way bill cannot take a new vehicle`, 409);
      const vehicle = String(a.vehicle_number ?? '').trim().toUpperCase().replace(/\s+/g, '') || null;
      if (!vehicle && !a.transporter_name) throw new EwayBillInputError('Enter the vehicle number or transporter');
      await client.query(
        `INSERT INTO eway_bill_vehicles (eway_bill_id, transport_mode, vehicle_number, transporter_name, transporter_gstin, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, a.transport_mode || 'road', vehicle, a.transporter_name || null, a.transporter_gstin || null, a.reason || 'Vehicle changed', userId]
      );
      break;
    }
    default:
      throw new EwayBillInputError('Unknown action');
  }
  return (await getEwayBill(client, businessId, id)) as EwayBillView;
}
