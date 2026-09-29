import type { PoolClient } from 'pg';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface AdvanceTableRow {
  place_of_supply: string;
  rate: number;
  /** Gross advance received / adjusted, excluding tax (the GSTN "gross advance" column). */
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface AdvanceMovement {
  pos: string;
  rate: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

function addTo(map: Map<string, AdvanceTableRow>, m: AdvanceMovement, sign: 1 | -1) {
  const key = `${m.pos}|${m.rate}`;
  const row =
    map.get(key) ||
    ({ place_of_supply: m.pos, rate: m.rate, taxable_value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 } as AdvanceTableRow);
  row.taxable_value = r2(row.taxable_value + sign * m.taxable);
  row.igst = r2(row.igst + sign * m.igst);
  row.cgst = r2(row.cgst + sign * m.cgst);
  row.sgst = r2(row.sgst + sign * m.sgst);
  row.cess = r2(row.cess + sign * m.cess);
  map.set(key, row);
}

/**
 * Table 11A: service advances received in the period on which tax is payable, net of any part
 * adjusted or refunded within the same period (those are reported with the invoice instead).
 * Table 11B: adjustments / refunds in the period of advances received in an earlier period,
 * reducing the tax paid then.
 */
export function buildAdvanceTables(input: {
  receivedInPeriod: AdvanceMovement[];
  consumedSamePeriod: AdvanceMovement[];
  consumedFromEarlier: AdvanceMovement[];
}): { at: AdvanceTableRow[]; atadj: AdvanceTableRow[] } {
  const at = new Map<string, AdvanceTableRow>();
  for (const m of input.receivedInPeriod) addTo(at, m, 1);
  for (const m of input.consumedSamePeriod) addTo(at, m, -1);
  const atadj = new Map<string, AdvanceTableRow>();
  for (const m of input.consumedFromEarlier) addTo(atadj, m, 1);
  const keep = (r: AdvanceTableRow) => Math.abs(r.taxable_value) > 0.005 || Math.abs(r.igst + r.cgst + r.sgst + r.cess) > 0.005;
  const sort = (a: AdvanceTableRow, b: AdvanceTableRow) => a.place_of_supply.localeCompare(b.place_of_supply) || a.rate - b.rate;
  return { at: [...at.values()].filter(keep).sort(sort), atadj: [...atadj.values()].filter(keep).sort(sort) };
}

export async function loadAdvanceTables(
  client: PoolClient,
  p: { businessId: string; branchId?: string | null; from: string; to: string }
): Promise<{ at: AdvanceTableRow[]; atadj: AdvanceTableRow[] }> {
  const params: unknown[] = [p.businessId, p.from, p.to];
  let branch = '';
  if (p.branchId) {
    params.push(p.branchId);
    branch = `AND a.branch_id = $${params.length}`;
  }
  const base = `a.business_id = $1 AND a.type = 'received' AND a.supply_type = 'services'
                AND a.status <> 'cancelled' AND COALESCE(a.tax_rate, 0) > 0 ${branch}`;
  const toMov = (r: any): AdvanceMovement => ({
    pos: String(r.pos || ''),
    rate: Number(r.rate) || 0,
    taxable: Number(r.taxable) || 0,
    igst: Number(r.igst) || 0,
    cgst: Number(r.cgst) || 0,
    sgst: Number(r.sgst) || 0,
    cess: Number(r.cess) || 0,
  });

  const received = await client.query(
    `SELECT a.place_of_supply_state_code AS pos, a.tax_rate AS rate,
            a.taxable_value AS taxable, a.igst, a.cgst, a.sgst, a.cess
       FROM advance_payments a
      WHERE ${base} AND a.payment_date BETWEEN $2::date AND $3::date`,
    params
  );
  const consumed = await client.query(
    `SELECT a.place_of_supply_state_code AS pos, a.tax_rate AS rate,
            aa.taxable_value AS taxable, aa.igst, aa.cgst, aa.sgst, aa.cess,
            (a.payment_date >= $2::date) AS same_period
       FROM advance_adjustments aa
       JOIN advance_payments a ON a.id = aa.advance_id
      WHERE ${base} AND aa.adjustment_date BETWEEN $2::date AND $3::date AND aa.reversed_at IS NULL`,
    params
  );
  return buildAdvanceTables({
    receivedInPeriod: received.rows.map(toMov),
    consumedSamePeriod: consumed.rows.filter((r) => r.same_period).map(toMov),
    consumedFromEarlier: consumed.rows.filter((r) => !r.same_period).map(toMov),
  });
}
