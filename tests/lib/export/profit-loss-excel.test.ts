import ExcelJS from 'exceljs';
import { buildPlExcelRows, generateProfitLossExcel, type PlExcelData } from '@/lib/export/profit-loss-excel';
import type { PlAccountNode, PlSectionBlock } from '@/lib/reports/profit-loss';

const node = (code: string, name: string, amount: number, children: PlAccountNode[] = [], active = true): PlAccountNode => ({
  id: code,
  account_code: code,
  account_name: name,
  account_type: 'expense',
  account_group_name: null,
  is_active: active,
  section: 'operating_expense',
  amount,
  total: amount + children.reduce((s, c) => s + c.total, 0),
  children,
});

const block = (key: PlSectionBlock['key'], label: string, accounts: PlAccountNode[]): PlSectionBlock => ({
  key,
  label,
  total: accounts.reduce((s, a) => s + a.total, 0),
  accounts,
});

const data: PlExcelData = {
  period: { from_date: '2026-04-01', to_date: '2026-09-30' },
  branch: null,
  sections: [
    block('operating_income', 'Operating Income', [node('4101', 'Sales', 10000)]),
    block('cost_of_goods_sold', 'Cost of Goods Sold', [node('5101', 'Purchases', 4000)]),
    block('operating_expense', 'Operating Expense', [node('5201', 'Rent', 1000, [node('5201-1', 'Godown rent', 500)]), node('5299', 'Old', 50, [], false)]),
    block('other_income', 'Non Operating Income', []),
    block('other_expense', 'Non Operating Expense', [node('5210', 'Current tax', 200)]),
  ],
  gross_profit: 6000,
  operating_profit: 4450,
  net_profit: 4250,
  periodic_cogs: null,
  elimination: { applied: true, net: 0 },
};

describe('profit-loss excel', () => {
  it('lays out sections, nested totals and profit lines in Zoho order', () => {
    const rows = buildPlExcelRows(data);
    const labels = rows.map((r) => r.label).filter(Boolean);
    expect(labels).toEqual([
      'Operating Income', 'Sales', 'Total for Operating Income',
      'Cost of Goods Sold', 'Purchases', 'Total for Cost of Goods Sold',
      'Gross Profit',
      'Operating Expense', 'Rent', 'Godown rent', 'Total for Rent', 'Old', 'Total for Operating Expense',
      'Operating Profit',
      'Non Operating Income', 'Total for Non Operating Income',
      'Non Operating Expense', 'Current tax', 'Total for Non Operating Expense',
      'Net Profit/Loss',
    ]);
    expect(rows.find((r) => r.label === 'Godown rent')?.indent).toBe(2);
    expect(rows.find((r) => r.label === 'Total for Rent')?.amount).toBe(1500);
    expect(rows.find((r) => r.label === 'Old')?.inactive).toBe(true);
  });

  it('shows the periodic stock schedule inside Cost of Goods Sold', () => {
    const rows = buildPlExcelRows({
      ...data,
      periodic_cogs: { opening_stock: 1000, purchases: 4000, closing_stock: 1500, cost_of_goods_sold: 3500 },
    });
    const i = rows.findIndex((r) => r.label === 'Cost of Goods Sold');
    expect(rows.slice(i + 1, i + 4).map((r) => r.amount)).toEqual([1000, 4000, -1500]);
  });

  it('writes a workbook with numeric amounts', async () => {
    const buf = await generateProfitLossExcel(data, { businessName: 'Shalini Traders', fromLabel: '01/04/2026', toLabel: '30/09/2026' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Profit and Loss')!;
    expect(ws.getCell('A1').value).toBe('Shalini Traders');
    const values: Record<string, unknown> = {};
    ws.eachRow((row) => {
      values[String(row.getCell(1).value)] = row.getCell(3).value;
    });
    expect(values['Net Profit/Loss']).toBe(4250);
    expect(values['Old (Inactive)']).toBe(50);
  });
});
