import type { PoolClient } from 'pg';
import { bookDepreciation, daysInclusive, fyLabel, fyStartYear } from './it-depreciation';
import { postDepreciationVoucher, disposalLines } from './fixed-asset-posting';
import { insertVoucherLines, requireAccountByCode, round2 } from './voucher-posting';
import { isPeriodLocked } from '@/lib/period-lock-utils';

export class FixedAssetError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface LockedAsset {
  id: string;
  asset_code: string;
  asset_name: string;
  purchase_cost: number;
  residual_value: number;
  useful_life_years: number;
  depreciation_method: 'SLM' | 'WDV';
  depreciation_rate: number | null;
  current_book_value: number;
  accumulated_depreciation: number;
  account_id: string;
  depreciation_account_id: string;
  is_disposed: boolean;
  branch_id: string | null;
  put_to_use_date: string;
  last_depreciated_to: string | null;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export async function lockAsset(client: PoolClient, businessId: string, assetId: string): Promise<LockedAsset> {
  const res = await client.query(
    `SELECT fa.id, fa.asset_code, fa.asset_name,
            fa.purchase_cost::float8 AS purchase_cost,
            COALESCE(fa.residual_value, 0)::float8 AS residual_value,
            fa.useful_life_years, fa.depreciation_method,
            fa.depreciation_rate::float8 AS depreciation_rate,
            fa.current_book_value::float8 AS current_book_value,
            COALESCE(fa.accumulated_depreciation, 0)::float8 AS accumulated_depreciation,
            fa.account_id, fa.depreciation_account_id, fa.is_disposed, fa.branch_id,
            to_char(COALESCE(fa.put_to_use_date, fa.purchase_date), 'YYYY-MM-DD') AS put_to_use_date,
            (SELECT to_char(MAX(ds.period_end_date), 'YYYY-MM-DD')
               FROM depreciation_schedule ds WHERE ds.asset_id = fa.id AND ds.is_posted) AS last_depreciated_to
       FROM fixed_assets fa
      WHERE fa.id = $1 AND fa.business_id = $2
      FOR UPDATE OF fa`,
    [assetId, businessId]
  );
  const asset = res.rows[0];
  if (!asset) throw new FixedAssetError(404, 'NOT_FOUND', 'Asset not found');
  return asset as LockedAsset;
}

/** First date not yet covered by a depreciation run. */
export function nextDepreciationStart(asset: Pick<LockedAsset, 'put_to_use_date' | 'last_depreciated_to'>): string {
  return asset.last_depreciated_to ? addDaysIso(asset.last_depreciated_to, 1) : asset.put_to_use_date;
}

/**
 * Posts one Schedule II depreciation run for [periodStart, periodEnd] (same FY),
 * writing depreciation_schedule and the Dr Depreciation / Cr 1202 voucher.
 */
export async function postAssetDepreciation(
  client: PoolClient,
  p: { businessId: string; branchId: string | null; asset: LockedAsset; periodStart: string; periodEnd: string }
): Promise<{ scheduleId: string | null; amount: number; financialYear: string }> {
  const { asset } = p;
  if (asset.is_disposed) throw new FixedAssetError(400, 'DISPOSED', 'Cannot depreciate a disposed asset');
  const expected = nextDepreciationStart(asset);
  if (p.periodStart < expected) {
    throw new FixedAssetError(
      409,
      'OVERLAP',
      `Depreciation is already posted up to ${asset.last_depreciated_to ?? 'the put-to-use date'}; the next period starts on ${expected}`
    );
  }
  if (daysInclusive(p.periodStart, p.periodEnd) === 0) {
    throw new FixedAssetError(400, 'INVALID_PERIOD', 'period_end_date must be on or after the period start');
  }
  const fy = fyStartYear(p.periodStart);
  if (fyStartYear(p.periodEnd) !== fy) {
    throw new FixedAssetError(400, 'CROSS_FY', 'A depreciation period cannot span two financial years');
  }
  const financialYear = fyLabel(fy);

  const { amount } = bookDepreciation({
    method: asset.depreciation_method,
    cost: Number(asset.purchase_cost),
    residual: Number(asset.residual_value),
    usefulLifeYears: Number(asset.useful_life_years),
    ratePct: asset.depreciation_rate,
    openingBookValue: Number(asset.current_book_value),
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    putToUseDate: asset.put_to_use_date,
  });

  const opening = round2(Number(asset.current_book_value));
  const closing = round2(opening - amount);
  const sched = await client.query<{ id: string }>(
    `INSERT INTO depreciation_schedule (
       business_id, asset_id, financial_year, period_start_date, period_end_date,
       opening_book_value, depreciation_amount, closing_book_value, is_posted, posted_date
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $5)
     RETURNING id`,
    [p.businessId, asset.id, financialYear, p.periodStart, p.periodEnd, opening, amount, closing]
  );
  const scheduleId = sched.rows[0].id;

  if (amount > 0) {
    await postDepreciationVoucher(client, {
      businessId: p.businessId,
      branchId: asset.branch_id ?? p.branchId,
      voucherId: scheduleId,
      expenseAccountId: asset.depreciation_account_id,
      amount,
      date: p.periodEnd,
      label: `Depreciation: ${asset.asset_name} (${p.periodStart} to ${p.periodEnd})`,
      reference: asset.asset_code,
    });
    await client.query(`UPDATE depreciation_schedule SET journal_entry_id = $1 WHERE id = $1`, [scheduleId]);
  }

  await client.query(
    `UPDATE fixed_assets
        SET current_book_value = $1,
            accumulated_depreciation = COALESCE(accumulated_depreciation, 0) + $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $3`,
    [closing, amount, asset.id]
  );
  asset.current_book_value = closing;
  asset.accumulated_depreciation = round2(Number(asset.accumulated_depreciation) + amount);
  asset.last_depreciated_to = p.periodEnd;

  return { scheduleId, amount, financialYear };
}

/** Depreciates from the next uncovered date up to `upTo`, one run per financial year. */
export async function depreciateUpTo(
  client: PoolClient,
  p: { businessId: string; branchId: string | null; asset: LockedAsset; upTo: string }
): Promise<number> {
  let total = 0;
  let start = nextDepreciationStart(p.asset);
  while (daysInclusive(start, p.upTo) > 0) {
    const fyEnd = `${fyStartYear(start) + 1}-03-31`;
    const end = fyEnd < p.upTo ? fyEnd : p.upTo;
    if (end !== p.upTo && (await isPeriodLocked(p.businessId, p.asset.branch_id ?? p.branchId, end))) {
      throw new FixedAssetError(
        423,
        'PERIOD_LOCKED',
        `Depreciation for the period ending ${end} is not posted and that period is locked; post it or unlock the period first`
      );
    }
    const r = await postAssetDepreciation(client, { ...p, periodStart: start, periodEnd: end });
    total = round2(total + r.amount);
    start = addDaysIso(end, 1);
  }
  return total;
}

export async function disposeAsset(
  client: PoolClient,
  p: {
    businessId: string;
    branchId: string | null;
    userId: string;
    asset: LockedAsset;
    disposalDate: string;
    proceeds: number;
    proceedsAccountId: string | null;
    reason?: string | null;
    buyerName?: string | null;
    chargeDepreciation: boolean;
  }
) {
  const { asset } = p;
  if (asset.is_disposed) throw new FixedAssetError(409, 'DISPOSED', 'Asset is already disposed');
  if (p.disposalDate < asset.put_to_use_date) {
    throw new FixedAssetError(400, 'INVALID_DATE', 'Disposal date cannot be before the put-to-use date');
  }
  if (asset.last_depreciated_to && p.disposalDate < asset.last_depreciated_to) {
    throw new FixedAssetError(
      400,
      'INVALID_DATE',
      `Depreciation is posted up to ${asset.last_depreciated_to}; disposal cannot be dated earlier`
    );
  }
  if (!(p.proceeds >= 0)) throw new FixedAssetError(400, 'INVALID_AMOUNT', 'Sale proceeds cannot be negative');

  let depreciationCharged = 0;
  if (p.chargeDepreciation) {
    depreciationCharged = await depreciateUpTo(client, {
      businessId: p.businessId,
      branchId: p.branchId,
      asset,
      upTo: p.disposalDate,
    });
  }

  let proceedsAccountId = p.proceedsAccountId;
  if (p.proceeds > 0) {
    if (proceedsAccountId) {
      const acc = await client.query(
        `SELECT id FROM accounts WHERE id = $1 AND business_id = $2 AND is_active = true`,
        [proceedsAccountId, p.businessId]
      );
      if (!acc.rows[0]) throw new FixedAssetError(400, 'INVALID_ACCOUNT', 'Proceeds account not found');
    } else {
      proceedsAccountId = await requireAccountByCode(client, p.businessId, '1102', 'Bank');
    }
  }

  const accumId = await requireAccountByCode(client, p.businessId, '1202', 'Accumulated Depreciation');
  const gainId = await requireAccountByCode(client, p.businessId, '4205', 'Profit on Sale of Fixed Assets');
  const lossId = await requireAccountByCode(client, p.businessId, '5218', 'Loss on Sale of Fixed Assets');
  const cost = round2(Number(asset.purchase_cost));
  const accumulated = round2(Number(asset.accumulated_depreciation));
  const bookValue = round2(cost - accumulated);

  const label = `Disposal: ${asset.asset_name} (${asset.asset_code})`;
  const { lines, gainLoss } = disposalLines({
    cost,
    accumulated,
    proceeds: round2(p.proceeds),
    assetAccountId: asset.account_id,
    accumAccountId: accumId,
    proceedsAccountId: proceedsAccountId ?? accumId,
    gainAccountId: gainId,
    lossAccountId: lossId,
    label,
  });

  const disp = await client.query<{ id: string }>(
    `INSERT INTO asset_disposals (
       business_id, asset_id, disposal_date, disposal_amount, disposal_account_id,
       reason, buyer_name, book_value, gain_loss, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      p.businessId,
      asset.id,
      p.disposalDate,
      round2(p.proceeds),
      proceedsAccountId,
      p.reason || null,
      p.buyerName || null,
      bookValue,
      gainLoss,
      p.userId,
    ]
  );
  const disposalId = disp.rows[0].id;

  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: asset.branch_id ?? p.branchId,
    voucherId: disposalId,
    voucherType: 'asset_disposal',
    entryDate: p.disposalDate,
    reference: asset.asset_code,
    lines,
  });

  await client.query(`UPDATE asset_disposals SET voucher_id = $1, journal_entry_id = $1 WHERE id = $1`, [disposalId]);
  await client.query(
    `UPDATE fixed_assets
        SET is_disposed = true, disposal_date = $1, disposal_amount = $2,
            disposal_account_id = $3, current_book_value = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4`,
    [p.disposalDate, round2(p.proceeds), proceedsAccountId, asset.id]
  );

  return { disposalId, bookValue, gainLoss, depreciationCharged };
}
