import { buildCashFlow, type CfAccount } from '@/lib/reports/cash-flow';

const acc = (code: string, type: string, debit: number, credit: number, extra: Partial<CfAccount> = {}): CfAccount => ({
  code,
  name: code,
  type,
  groupCode: null,
  isCash: false,
  opening: 0,
  periodDebit: debit,
  periodCredit: credit,
  ...extra,
});

describe('buildCashFlow', () => {
  it('ties net cash flow to cash ledger movement across all sections', () => {
    // Sale 11800 on credit (10000 + GST 1800), collected 5000; purchase 5900 cash (5000 + ITC 900);
    // fixed asset 20000 by bank; capital 50000; depreciation 1000; sale of asset cost 4000, accum 1000, proceeds 3500 (gain 500).
    const accounts = [
      acc('1102', 'asset', 50000 + 5000 + 3500, 5900 + 20000, { isCash: true, opening: 1000 }),
      acc('1103', 'asset', 11800, 5000),
      acc('4101', 'income', 0, 10000),
      acc('2150', 'liability', 0, 900),
      acc('2151', 'liability', 0, 900),
      acc('5101', 'expense', 5000, 0),
      acc('1110', 'asset', 450, 0),
      acc('1111', 'asset', 450, 0),
      acc('1201', 'asset', 20000, 4000, { groupCode: '1200' }),
      acc('1202', 'asset', 1000, 1000),
      acc('5204', 'expense', 1000, 0),
      acc('4205', 'income', 0, 500),
      acc('3001', 'capital', 0, 50000),
    ];
    const cf = buildCashFlow(accounts);

    expect(cf.netProfit).toBe(4500);
    expect(cf.openingCash).toBe(1000);
    expect(cf.closingCash).toBe(1000 + 58500 - 25900);
    expect(cf.difference).toBe(0);
    expect(cf.netCashFlow).toBe(58500 - 25900);
    expect(cf.investing.lines.find((l) => l.label === 'Sale of fixed assets')?.amount).toBe(3500);
    expect(cf.investing.lines.find((l) => l.label === 'Purchase of fixed assets')?.amount).toBe(-20000);
    expect(cf.operating.adjustments.find((l) => l.label === 'Add: depreciation')?.amount).toBe(1000);
    expect(cf.financing.total).toBe(50000);
    expect(cf.operating.workingCapital.find((l) => l.label === 'GST payable')?.amount).toBe(1800);
    expect(cf.operating.workingCapital.find((l) => l.label === 'GST input credit')?.amount).toBe(-900);
  });

  it('classifies an electronic cash ledger deposit as a bank outflow and a utilisation as no extra cash movement', () => {
    const deposit = buildCashFlow([
      acc('1102', 'asset', 0, 500, { isCash: true }),
      acc('1130', 'asset', 500, 0),
    ]);
    expect(deposit.difference).toBe(0);
    expect(deposit.netCashFlow).toBe(-500);
    expect(deposit.operating.workingCapital.find((l) => l.label === 'GST electronic cash ledger')?.amount).toBe(-500);

    const utilised = buildCashFlow([
      acc('1102', 'asset', 0, 0, { isCash: true, opening: 1000 }),
      acc('1130', 'asset', 0, 500),
      acc('2152', 'liability', 500, 0),
    ]);
    expect(utilised.difference).toBe(0);
    expect(utilised.netCashFlow).toBe(0);
    expect(utilised.closingCash).toBe(1000);
  });

  it('starts from P&L net profit in periodic books and backs the closing stock out of inventories', () => {
    // Purchases 8000 by bank, sales 6000 by bank; closing stock 3000 counted (periodic, no 1104 movement).
    const accounts = [
      acc('1102', 'asset', 6000, 8000, { isCash: true, opening: 10000 }),
      acc('4101', 'income', 0, 6000),
      acc('5101', 'expense', 8000, 0),
    ];
    const cf = buildCashFlow(accounts, { inventoryAdjustment: 3000 });
    expect(cf.netProfit).toBe(1000);
    expect(cf.operating.workingCapital.find((l) => l.label === 'Inventories')?.amount).toBe(-3000);
    expect(cf.netCashFlow).toBe(-2000);
    expect(cf.difference).toBe(0);
  });

  it('treats bank overdraft as negative cash', () => {
    const cf = buildCashFlow([
      acc('2112', 'liability', 0, 3000, { isCash: true }),
      acc('5105', 'expense', 3000, 0),
    ]);
    expect(cf.closingCash).toBe(-3000);
    expect(cf.netCashFlow).toBe(-3000);
    expect(cf.difference).toBe(0);
  });
});
