import type { PoolClient } from 'pg';
import { accountIdByCode, insertVoucherLines, round2 as r2, type VoucherLine as Line } from './voucher-posting';

export type AssetFunding = 'bank' | 'cash' | 'credit' | 'opening';

/** Credit side of an asset purchase by funding mode. */
export async function fundingAccountId(
  client: PoolClient,
  businessId: string,
  funding: AssetFunding,
  explicitAccountId?: string | null
): Promise<string> {
  if (explicitAccountId) return explicitAccountId;
  const code = { bank: '1102', cash: '1101', credit: '2101', opening: '3100' }[funding];
  const id = await accountIdByCode(client, businessId, code);
  if (!id) throw new Error(`Ledger account ${code} not found; initialise the chart of accounts`);
  return id;
}

/** Dr Fixed Asset / Cr Bank, Cash, Creditors or Opening Balance Adjustment. */
export async function postAssetCapitalisation(
  client: PoolClient,
  p: {
    businessId: string;
    branchId: string | null;
    voucherId: string;
    assetAccountId: string;
    creditAccountId: string;
    amount: number;
    date: string | Date;
    assetName: string;
    assetCode: string;
  }
): Promise<void> {
  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: p.branchId,
    voucherId: p.voucherId,
    voucherType: 'asset_purchase',
    entryDate: p.date,
    reference: p.assetCode,
    lines: [
      { accountId: p.assetAccountId, debit: p.amount, credit: 0, narration: `Fixed asset purchase: ${p.assetName}` },
      { accountId: p.creditAccountId, debit: 0, credit: p.amount, narration: `Fixed asset purchase: ${p.assetName}` },
    ],
  });
}

/** Dr Depreciation expense / Cr Accumulated Depreciation (1202). */
export async function postDepreciationVoucher(
  client: PoolClient,
  p: {
    businessId: string;
    branchId: string | null;
    voucherId: string;
    expenseAccountId: string;
    amount: number;
    date: string | Date;
    label: string;
    reference: string;
  }
): Promise<void> {
  const accum = await accountIdByCode(client, p.businessId, '1202');
  if (!accum) throw new Error('Accumulated Depreciation (1202) account not found');
  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: p.branchId,
    voucherId: p.voucherId,
    voucherType: 'depreciation',
    entryDate: p.date,
    reference: p.reference,
    lines: [
      { accountId: p.expenseAccountId, debit: p.amount, credit: 0, narration: p.label },
      { accountId: accum, debit: 0, credit: p.amount, narration: p.label },
    ],
  });
}

/**
 * Disposal: Dr Bank/Cash (proceeds) + Dr Accumulated Depreciation / Cr Fixed Asset (cost),
 * balancing to 4205 Profit or 5218 Loss on Sale of Fixed Assets.
 */
export function disposalLines(p: {
  cost: number;
  accumulated: number;
  proceeds: number;
  assetAccountId: string;
  accumAccountId: string;
  proceedsAccountId: string;
  gainAccountId: string;
  lossAccountId: string;
  label: string;
}): { lines: Line[]; gainLoss: number } {
  const bookValue = r2(p.cost - p.accumulated);
  const gainLoss = r2(p.proceeds - bookValue);
  const lines: Line[] = [
    { accountId: p.proceedsAccountId, debit: p.proceeds, credit: 0, narration: p.label },
    { accountId: p.accumAccountId, debit: p.accumulated, credit: 0, narration: p.label },
    { accountId: p.assetAccountId, debit: 0, credit: p.cost, narration: p.label },
  ];
  if (gainLoss > 0) lines.push({ accountId: p.gainAccountId, debit: 0, credit: gainLoss, narration: `${p.label} - profit` });
  if (gainLoss < 0) lines.push({ accountId: p.lossAccountId, debit: -gainLoss, credit: 0, narration: `${p.label} - loss` });
  return { lines, gainLoss };
}
