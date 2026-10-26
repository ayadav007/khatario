import type { PoolClient } from 'pg';

/**
 * Job work under s.143: what went to job workers, what came back, and what is still out with
 * its return deadline. Inputs must come back within 1 year and capital goods within 3 of the
 * challan date; past that, the goods are treated as supplied on the day they were sent.
 * ITC-04 is filed from the sent (table 4) and received (table 5) lists.
 */

type Queryable = Pick<PoolClient, 'query'>;

export const JOB_WORK_YEARS = { inputs: 1, capital_goods: 3 } as const;

/** Last day goods may stay with the job worker. */
export function jobWorkDeadline(challanDate: string, goods: 'inputs' | 'capital_goods' | null): string {
  const d = new Date(`${challanDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + JOB_WORK_YEARS[goods === 'capital_goods' ? 'capital_goods' : 'inputs']);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

export interface JobWorkSentRow {
  challan_id: string;
  challan_number: string;
  challan_date: string;
  job_worker: string | null;
  job_worker_gstin: string | null;
  job_worker_state: string | null;
  job_work_goods: 'inputs' | 'capital_goods';
  item_name: string;
  hsn_sac: string | null;
  uqc: string | null;
  qty: number;
  taxable_value: number;
  tax_rate: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export interface JobWorkReceivedRow {
  challan_id: string;
  challan_number: string;
  challan_date: string;
  return_date: string;
  job_worker: string | null;
  job_worker_gstin: string | null;
  item_name: string;
  hsn_sac: string | null;
  uqc: string | null;
  qty_returned: number;
  qty_lost: number;
}

export interface JobWorkOpenRow {
  challan_id: string;
  challan_number: string;
  challan_date: string;
  job_worker: string | null;
  job_work_goods: 'inputs' | 'capital_goods';
  item_name: string;
  qty_open: number;
  deadline: string;
  days_left: number;
  deemed_supply: boolean;
}

/** Sent and received in [from, to], and everything still out as of `asOf`. */
export async function jobWorkRegister(
  db: Queryable,
  businessId: string,
  period: { from: string; to: string; asOf?: string }
): Promise<{ sent: JobWorkSentRow[]; received: JobWorkReceivedRow[]; open: JobWorkOpenRow[] }> {
  const asOf = period.asOf || new Date().toISOString().slice(0, 10);
  const sent = await db.query(
    `SELECT dc.id AS challan_id, dc.challan_number, dc.challan_date::text, s.name AS job_worker,
            s.gstin AS job_worker_gstin, s.state AS job_worker_state,
            COALESCE(dc.job_work_goods, 'inputs') AS job_work_goods,
            dci.item_name, COALESCE(dci.hsn_sac, i.hsn_sac) AS hsn_sac, COALESCE(i.uqc, dci.unit) AS uqc,
            dci.qty::float AS qty, COALESCE(dci.taxable_value, 0)::float AS taxable_value,
            COALESCE(dci.tax_rate, 0)::float AS tax_rate, COALESCE(dci.igst_amount, 0)::float AS igst,
            COALESCE(dci.cgst_amount, 0)::float AS cgst, COALESCE(dci.sgst_amount, 0)::float AS sgst
       FROM delivery_challans dc
       JOIN delivery_challan_items dci ON dci.delivery_challan_id = dc.id AND dci.item_id IS NOT NULL
       LEFT JOIN items i ON i.id = dci.item_id
       LEFT JOIN suppliers s ON s.id = dc.supplier_id
      WHERE dc.business_id = $1 AND dc.challan_kind = 'returnable' AND dc.purpose = 'job_work'
        AND dc.stock_posted_at IS NOT NULL AND dc.challan_date BETWEEN $2::date AND $3::date
      ORDER BY dc.challan_date, dc.challan_number, dci.sort_order`,
    [businessId, period.from, period.to]
  );
  const received = await db.query(
    `SELECT dc.id AS challan_id, dc.challan_number, dc.challan_date::text, r.return_date::text,
            s.name AS job_worker, s.gstin AS job_worker_gstin,
            dci.item_name, COALESCE(dci.hsn_sac, i.hsn_sac) AS hsn_sac, COALESCE(i.uqc, dci.unit) AS uqc,
            r.qty_returned::float AS qty_returned, r.qty_written_off::float AS qty_lost
       FROM delivery_challan_returns r
       JOIN delivery_challans dc ON dc.id = r.delivery_challan_id
       JOIN delivery_challan_items dci ON dci.id = r.challan_item_id
       LEFT JOIN items i ON i.id = dci.item_id
       LEFT JOIN suppliers s ON s.id = dc.supplier_id
      WHERE dc.business_id = $1 AND dc.purpose = 'job_work'
        AND r.return_date BETWEEN $2::date AND $3::date
        AND (r.qty_returned > 0 OR r.qty_written_off > 0)
      ORDER BY r.return_date, dc.challan_number`,
    [businessId, period.from, period.to]
  );
  // What is out as of a date: sent on or before it, less what came back on or before it.
  const open = await db.query(
    `SELECT dc.id AS challan_id, dc.challan_number, dc.challan_date::text, s.name AS job_worker,
            COALESCE(dc.job_work_goods, 'inputs') AS job_work_goods, dci.item_name,
            (dci.qty - COALESCE((
               SELECT SUM(r.qty_returned + r.qty_invoiced + r.qty_written_off) FROM delivery_challan_returns r
                WHERE r.challan_item_id = dci.id AND r.return_date <= $2::date
             ), 0))::float AS qty_open
       FROM delivery_challans dc
       JOIN delivery_challan_items dci ON dci.delivery_challan_id = dc.id AND dci.item_id IS NOT NULL
       LEFT JOIN suppliers s ON s.id = dc.supplier_id
      WHERE dc.business_id = $1 AND dc.challan_kind = 'returnable' AND dc.purpose = 'job_work'
        AND dc.stock_posted_at IS NOT NULL AND dc.challan_date <= $2::date
      ORDER BY dc.challan_date, dc.challan_number`,
    [businessId, asOf]
  );
  return {
    sent: sent.rows,
    received: received.rows,
    open: open.rows
      .filter((r: any) => r.qty_open > 0.0005)
      .map((r: any) => {
        const deadline = jobWorkDeadline(r.challan_date, r.job_work_goods);
        const daysLeft = daysBetween(asOf, deadline);
        return { ...r, deadline, days_left: daysLeft, deemed_supply: daysLeft < 0 };
      }),
  };
}
