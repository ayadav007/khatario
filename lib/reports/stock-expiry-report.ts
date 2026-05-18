/**
 * Stock expiry report — batch-level expiry from item_batches.
 * Joins items + warehouses (item_batches.location_id → warehouses.id).
 */

import * as db from '@/lib/db';

export type StockExpiryReportType = 'expired' | 'expiring';

export interface StockExpiryRow {
  item_id: string;
  item_name: string;
  item_code: string | null;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  warehouse_name: string | null;
  days_left: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAsOfDate(raw: string | null): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw?.trim() || new Date().toISOString().split('T')[0];
  if (!ISO_DATE.test(v)) {
    return { ok: false, error: 'as_of_date must be YYYY-MM-DD' };
  }
  const d = new Date(`${v}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: 'as_of_date is not a valid calendar date' };
  }
  return { ok: true, value: v };
}

export function parseExpiryType(raw: string | null): { ok: true; value: StockExpiryReportType } | { ok: false; error: string } {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'expired' || v === 'expiring') {
    return { ok: true, value: v };
  }
  return { ok: false, error: 'type is required and must be "expired" or "expiring"' };
}

export function parseDays(raw: string | null, type: StockExpiryReportType): { ok: true; value: number } | { ok: false; error: string } {
  if (type === 'expired') {
    return { ok: true, value: 0 };
  }
  const defaultDays = 15;
  const n = raw != null && raw !== '' ? parseInt(raw, 10) : defaultDays;
  if (!Number.isFinite(n) || n < 1) {
    return { ok: false, error: 'days must be a positive integer (default 15 for type=expiring)' };
  }
  return { ok: true, value: n };
}

/**
 * Fetch stock expiry rows. Uses only item_batches.expiry_date (not items).
 */
export async function fetchStockExpiryRows(
  businessId: string,
  options: {
    type: StockExpiryReportType;
    asOfDate: string;
    days: number;
    warehouseId?: string | null;
  }
): Promise<StockExpiryRow[]> {
  const { type, asOfDate, days, warehouseId } = options;

  const values: unknown[] = [businessId, asOfDate];

  let dateFilter: string;
  if (type === 'expired') {
    dateFilter = `b.expiry_date < $2::date`;
  } else {
    values.push(days);
    dateFilter = `
      b.expiry_date >= $2::date
      AND b.expiry_date <= ($2::date + $3::integer)
    `;
  }

  let warehouseClause = '';
  if (warehouseId) {
    values.push(warehouseId);
    warehouseClause = `AND b.location_id = $${values.length}::uuid`;
  }

  const sql = `
    SELECT
      i.id AS item_id,
      i.name AS item_name,
      i.code AS item_code,
      b.batch_number,
      to_char(b.expiry_date::date, 'YYYY-MM-DD') AS expiry_date,
      b.quantity::float8 AS quantity,
      w.name AS warehouse_name,
      (b.expiry_date::date - $2::date)::integer AS days_left
    FROM item_batches b
    INNER JOIN items i ON i.id = b.item_id AND i.business_id = b.business_id
    LEFT JOIN warehouses w ON w.id = b.location_id AND w.business_id = b.business_id
    WHERE b.business_id = $1::uuid
      AND b.expiry_date IS NOT NULL
      AND b.quantity > 0
      AND (${dateFilter})
      ${warehouseClause}
    ORDER BY b.expiry_date ASC, i.name ASC, b.batch_number ASC
  `;

  const rows = await db.queryRows<{
    item_id: string;
    item_name: string;
    item_code: string | null;
    batch_number: string;
    expiry_date: string;
    quantity: string | number;
    warehouse_name: string | null;
    days_left: string | number;
  }>(sql, values);

  return rows.map((r) => ({
    item_id: r.item_id,
    item_name: r.item_name,
    item_code: r.item_code ?? null,
    batch_number: r.batch_number,
    expiry_date: r.expiry_date,
    quantity: typeof r.quantity === 'number' ? r.quantity : parseFloat(String(r.quantity)),
    warehouse_name: r.warehouse_name ?? null,
    days_left: typeof r.days_left === 'number' ? Math.trunc(r.days_left) : parseInt(String(r.days_left), 10),
  }));
}
