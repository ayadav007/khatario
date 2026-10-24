import { query, queryOne, queryRows } from '@/lib/db';
import { periodFilingOpensOn } from './checks';

export type MarkedReturnType = 'GSTR3B';

export interface ReturnMark {
  id: string;
  return_type: MarkedReturnType;
  period: string;
  filed_on: string;
  arn: string | null;
  created_at: string;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ReturnMarkInputError extends Error {}

export function validateReturnMarkInput(input: {
  return_type?: unknown;
  period?: unknown;
  filed_on?: unknown;
  arn?: unknown;
  today: string;
}): { returnType: MarkedReturnType; period: string; filedOn: string; arn: string | null } {
  const returnType = input.return_type ?? 'GSTR3B';
  if (returnType !== 'GSTR3B') throw new ReturnMarkInputError('return_type must be GSTR3B');
  const period = typeof input.period === 'string' ? input.period.trim() : '';
  if (!PERIOD_RE.test(period)) throw new ReturnMarkInputError('period must be YYYY-MM');
  const filedOn = typeof input.filed_on === 'string' && input.filed_on.trim() ? input.filed_on.trim() : input.today;
  if (!DATE_RE.test(filedOn) || Number.isNaN(Date.parse(`${filedOn}T00:00:00Z`))) {
    throw new ReturnMarkInputError('filed_on must be YYYY-MM-DD');
  }
  if (filedOn > input.today) throw new ReturnMarkInputError('filed_on cannot be in the future');
  if (filedOn < periodFilingOpensOn(period)) {
    throw new ReturnMarkInputError('A return can only be filed after its period ends');
  }
  const rawArn = typeof input.arn === 'string' ? input.arn.trim().toUpperCase() : '';
  if (rawArn && !/^[A-Z0-9]{10,20}$/.test(rawArn)) throw new ReturnMarkInputError('ARN should be 10 to 20 letters or digits');
  return { returnType, period, filedOn, arn: rawArn || null };
}

const SELECT = `id, return_type, period, to_char(filed_on, 'YYYY-MM-DD') AS filed_on, arn, created_at`;

export async function markReturnFiled(
  businessId: string,
  userId: string,
  m: { returnType: MarkedReturnType; period: string; filedOn: string; arn: string | null },
): Promise<ReturnMark> {
  const row = await queryOne<ReturnMark>(
    `INSERT INTO gst_return_marks (business_id, return_type, period, filed_on, arn, marked_by)
     VALUES ($1::uuid, $2, $3, $4::date, $5, $6::uuid)
     ON CONFLICT (business_id, return_type, period) DO UPDATE SET
       filed_on = EXCLUDED.filed_on, arn = EXCLUDED.arn, marked_by = EXCLUDED.marked_by, updated_at = CURRENT_TIMESTAMP
     RETURNING ${SELECT}`,
    [businessId, m.returnType, m.period, m.filedOn, m.arn, userId],
  );
  if (!row) throw new Error('Could not save the filing mark');
  return row;
}

export async function unmarkReturnFiled(businessId: string, returnType: MarkedReturnType, period: string): Promise<boolean> {
  const res = await query(`DELETE FROM gst_return_marks WHERE business_id = $1::uuid AND return_type = $2 AND period = $3`, [
    businessId,
    returnType,
    period,
  ]);
  return (res.rowCount ?? 0) > 0;
}

export async function listReturnMarks(businessId: string, returnType: MarkedReturnType, periods?: string[]): Promise<ReturnMark[]> {
  return periods?.length
    ? queryRows<ReturnMark>(
        `SELECT ${SELECT} FROM gst_return_marks WHERE business_id = $1::uuid AND return_type = $2 AND period = ANY($3::text[]) ORDER BY period DESC`,
        [businessId, returnType, periods],
      )
    : queryRows<ReturnMark>(
        `SELECT ${SELECT} FROM gst_return_marks WHERE business_id = $1::uuid AND return_type = $2 ORDER BY period DESC LIMIT 24`,
        [businessId, returnType],
      );
}
