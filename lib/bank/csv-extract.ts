import { parse } from 'csv-parse/sync';
import type { BankImportPreview, NormalizedBankRow } from '@/lib/bank/types';
import { makePreviewRow, parseInrAmount, parseStatementDate, roundMoney } from '@/lib/bank/normalize';

function normHeader(h: string): string {
  return h.replace(/\s+/g, ' ').trim().toLowerCase();
}

function pickColumn(
  row: Record<string, string>,
  candidates: string[]
): string | undefined {
  const keys = Object.keys(row);
  const map = new Map(keys.map((k) => [normHeader(k), k]));
  for (const c of candidates) {
    const k = map.get(normHeader(c));
    if (k) return row[k];
  }
  for (const c of candidates) {
    const found = keys.find((k) => normHeader(k).includes(normHeader(c)));
    if (found) return row[found];
  }
  return undefined;
}

export function extractBankRowsFromCsv(buffer: Buffer, fileName: string): BankImportPreview {
  const text = buffer.toString('utf8');
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: NormalizedBankRow[] = [];
  const warnings: string[] = [];

  for (const rec of records) {
    const dateRaw = pickColumn(rec, [
      'date',
      'txn date',
      'transaction date',
      'value date',
      'posting date',
      'tran date',
    ]);
    const desc =
      pickColumn(rec, ['description', 'particulars', 'narration', 'remarks', 'details']) ?? '';
    const debitRaw = pickColumn(rec, ['debit', 'withdrawal', 'withdrawals', 'dr', 'outflow']);
    const creditRaw = pickColumn(rec, ['credit', 'deposit', 'deposits', 'cr', 'inflow']);
    const balRaw = pickColumn(rec, ['balance', 'closing balance', 'running balance']);

    const date = parseStatementDate(dateRaw);
    if (!date) {
      warnings.push(`Skipped row (bad date): ${JSON.stringify(rec).slice(0, 120)}`);
      continue;
    }
    const debit = parseInrAmount(debitRaw) ?? 0;
    const credit = parseInrAmount(creditRaw) ?? 0;
    const balance = parseInrAmount(balRaw);

    rows.push(
      makePreviewRow({
        date,
        description: String(desc).slice(0, 2000),
        debit: roundMoney(debit),
        credit: roundMoney(credit),
        balance: balance != null ? roundMoney(balance) : null,
      })
    );
  }

  if (rows.length === 0 && records.length > 0) {
    warnings.push('No rows parsed — check column headers (Date, Description, Debit, Credit, Balance).');
  }

  return {
    fileName,
    fileType: 'csv',
    sourceType: 'csv',
    rows,
    warnings,
  };
}
