import ExcelJS from 'exceljs';
import type { PlAccountNode, PlSectionBlock, PeriodicCogsSchedule } from '@/lib/reports/profit-loss';

/** The subset of the /api/reports/profit-loss response the workbook needs. */
export interface PlExcelData {
  period: { from_date: string; to_date: string };
  branch?: { name?: string | null } | null;
  sections: PlSectionBlock[];
  gross_profit: number;
  operating_profit: number;
  net_profit: number;
  periodic_cogs: PeriodicCogsSchedule | null;
  elimination?: { applied: boolean; net: number } | null;
}

export interface PlExcelRow {
  kind: 'title' | 'section' | 'account' | 'subtotal' | 'section_total' | 'profit' | 'blank';
  label: string;
  code?: string;
  amount?: number;
  indent?: number;
  inactive?: boolean;
}

const MONEY = '#,##0.00;(#,##0.00);0.00';

function accountRows(nodes: PlAccountNode[], depth: number): PlExcelRow[] {
  return nodes.flatMap((n) => [
    { kind: 'account' as const, label: n.account_name, code: n.account_code, amount: n.amount, indent: depth, inactive: !n.is_active },
    ...accountRows(n.children, depth + 1),
    ...(n.children.length
      ? [{ kind: 'subtotal' as const, label: `Total for ${n.account_name}`, amount: n.total, indent: depth }]
      : []),
  ]);
}

/** Zoho layout: each section with nested accounts and a total, profit lines in between. */
export function buildPlExcelRows(data: PlExcelData): PlExcelRow[] {
  const byKey = new Map(data.sections.map((s) => [s.key, s]));
  const section = (key: string): PlExcelRow[] => {
    const s = byKey.get(key as PlSectionBlock['key']);
    if (!s) return [];
    const rows: PlExcelRow[] = [{ kind: 'section', label: s.label }];
    if (key === 'cost_of_goods_sold' && data.periodic_cogs) {
      const p = data.periodic_cogs;
      rows.push(
        { kind: 'account', label: 'Opening Stock', amount: p.opening_stock, indent: 1 },
        { kind: 'account', label: 'Add: Purchases (net of returns)', amount: p.purchases, indent: 1 },
        { kind: 'account', label: 'Less: Closing Stock', amount: -p.closing_stock, indent: 1 },
      );
    }
    rows.push(...accountRows(s.accounts, 1));
    rows.push({ kind: 'section_total', label: `Total for ${s.label}`, amount: s.total });
    return rows;
  };
  const profit = (label: string, amount: number): PlExcelRow[] => [
    { kind: 'profit', label, amount },
    { kind: 'blank', label: '' },
  ];
  const rows = [
    ...section('operating_income'),
    ...section('cost_of_goods_sold'),
    ...profit('Gross Profit', data.gross_profit),
    ...section('operating_expense'),
    ...profit('Operating Profit', data.operating_profit),
    ...section('other_income'),
    ...section('other_expense'),
  ];
  if (data.elimination?.applied && Math.abs(data.elimination.net) >= 0.005) {
    rows.push({ kind: 'account', label: 'Inter-branch difference (not eliminated)', amount: data.elimination.net, indent: 0 });
  }
  rows.push({ kind: 'profit', label: 'Net Profit/Loss', amount: data.net_profit });
  return rows;
}

export async function generateProfitLossExcel(
  data: PlExcelData,
  meta: { businessName: string; fromLabel: string; toLabel: string }
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Khatario';
  wb.created = new Date();
  const ws = wb.addWorksheet('Profit and Loss', { views: [{ state: 'frozen', ySplit: 6 }] });
  ws.columns = [
    { key: 'label', width: 52 },
    { key: 'code', width: 14 },
    { key: 'amount', width: 18 },
  ];

  const header = [
    meta.businessName,
    'Profit and Loss',
    'Basis : Accrual',
    `From ${meta.fromLabel} To ${meta.toLabel}${data.branch?.name ? ` — ${data.branch.name}` : ''}`,
  ];
  header.forEach((text, i) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, 3);
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(1).font = { bold: i < 2, size: i === 1 ? 14 : 11 };
  });
  ws.addRow([]);
  const head = ws.addRow(['Account', 'Account Code', 'Total']);
  head.font = { bold: true };
  head.getCell(3).alignment = { horizontal: 'right' };
  head.eachCell((c) => {
    c.border = { bottom: { style: 'thin' } };
  });

  for (const r of buildPlExcelRows(data)) {
    const label = r.inactive ? `${r.label} (Inactive)` : r.label;
    const row = ws.addRow([label, r.code ?? '', r.amount ?? null]);
    row.getCell(1).alignment = { indent: r.indent ?? 0 };
    row.getCell(3).numFmt = MONEY;
    if (r.kind === 'section') row.font = { bold: true, size: 12 };
    if (r.kind === 'subtotal') row.font = { italic: true };
    if (r.kind === 'section_total' || r.kind === 'profit') {
      row.font = { bold: true };
      row.getCell(3).border = { top: { style: 'thin' } };
    }
    if (r.kind === 'profit') {
      row.eachCell({ includeEmpty: true }, (c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      });
    }
    if (r.inactive) row.getCell(1).font = { color: { argb: 'FF6B7280' } };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
