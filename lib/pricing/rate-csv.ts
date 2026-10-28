/**
 * Customer prices and price level rates as CSV (Excel opens and saves it), for bulk upload.
 * Columns, matched by header name in any order:
 *   item_code | item_name, variant, price, discount_percent, min_qty (levels only), valid_from, valid_to
 * An item is found by code first, then by exact name (ignoring case). Dates are YYYY-MM-DD.
 */

export const RATE_CSV_HEADERS = ['item_code', 'item_name', 'variant', 'price', 'discount_percent', 'min_qty', 'valid_from', 'valid_to'];

/** RFC 4180 CSV: commas, quotes with "" escapes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export interface CsvItem {
  id: string;
  name: string;
  code?: string | null;
}

export interface CsvVariant {
  id: string;
  item_id: string;
  variant_name: string;
}

export interface CsvRateRow {
  item_id: string;
  variant_id: string | null;
  min_qty?: number;
  price: number | null;
  discount_percent: number | null;
  valid_from: string | null;
  valid_to: string | null;
}

/** Turn parsed CSV into API rows; every problem is reported with its line number and nothing is guessed. */
export function csvToRateRows(
  table: string[][],
  items: CsvItem[],
  variants: CsvVariant[],
  opts: { withMinQty: boolean }
): { rows: CsvRateRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: CsvRateRow[] = [];
  if (table.length < 2) return { rows, errors: ['The file has no rows under the header'] };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (name: string) => header.indexOf(name);
  if (col('item_code') < 0 && col('item_name') < 0) return { rows, errors: ['Add an item_code or item_name column'] };
  if (col('price') < 0 && col('discount_percent') < 0) return { rows, errors: ['Add a price or discount_percent column'] };

  const byCode = new Map(items.filter((i) => i.code).map((i) => [String(i.code).trim().toLowerCase(), i]));
  const byName = new Map(items.map((i) => [i.name.trim().toLowerCase(), i]));
  const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '');
  const num = (s: string, line: number, label: string, max?: number): number | null | undefined => {
    if (s === '') return null;
    const n = Number(s.replace(/[₹,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0 || (max != null && n > max)) {
      errors.push(`Line ${line}: ${label} "${s}" is not valid`);
      return undefined;
    }
    return Math.round(n * 100) / 100;
  };
  const date = (s: string, line: number, label: string): string | null | undefined => {
    if (s === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
      errors.push(`Line ${line}: ${label} "${s}" must be YYYY-MM-DD`);
      return undefined;
    }
    return s;
  };

  table.slice(1).forEach((r, k) => {
    const line = k + 2;
    const code = get(r, 'item_code').toLowerCase();
    const name = get(r, 'item_name').toLowerCase();
    const item = (code && byCode.get(code)) || (name && byName.get(name)) || null;
    if (!item) {
      errors.push(`Line ${line}: no item "${get(r, 'item_code') || get(r, 'item_name')}"`);
      return;
    }
    let variantId: string | null = null;
    const vName = get(r, 'variant').toLowerCase();
    if (vName) {
      const v = variants.find((x) => x.item_id === item.id && x.variant_name.trim().toLowerCase() === vName);
      if (!v) {
        errors.push(`Line ${line}: ${item.name} has no variant "${get(r, 'variant')}"`);
        return;
      }
      variantId = v.id;
    }
    const price = num(get(r, 'price'), line, 'price');
    const discount = num(get(r, 'discount_percent'), line, 'discount %', 100);
    const minQty = opts.withMinQty ? num(get(r, 'min_qty'), line, 'min qty') : null;
    const from = date(get(r, 'valid_from'), line, 'valid_from');
    const to = date(get(r, 'valid_to'), line, 'valid_to');
    if ([price, discount, minQty, from, to].includes(undefined)) return;
    if (from && to && from > to) {
      errors.push(`Line ${line}: valid_to is before valid_from`);
      return;
    }
    rows.push({
      item_id: item.id,
      variant_id: variantId,
      ...(opts.withMinQty ? { min_qty: minQty ?? 0 } : {}),
      price: price ?? null,
      discount_percent: discount ?? null,
      valid_from: from ?? null,
      valid_to: to ?? null,
    });
  });
  return { rows, errors };
}

/** Download text as a file in the browser. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
