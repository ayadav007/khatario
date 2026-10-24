/**
 * GSTR-2B Excel download parser.
 *
 * The GST portal workbook is not one fixed layout. Detail sheets are recognized by name
 * (B2B, B2BA, B2B-CDNR, CDNRA, ISD, ISDA, IMPG, IMPGSEZ and their amendment sheets).
 * Column positions come from the header labels, including the portal's two-row headers
 * where a group title sits above "Invoice number" or "Integrated Tax".
 *
 * This has been checked against that published sheet structure and against synthetic
 * workbooks. It has not been checked against a genuine portal file in this repository.
 */
import ExcelJS from 'exceljs';
import { normalizePortalDate, type Gstr2bDocType, type Gstr2bRow } from '@/lib/gst/gstr2b-portal-parser';

export interface Gstr2bSheetReport {
  sheet: string;
  status: 'imported' | 'skipped' | 'rejected';
  documents: number;
  reason?: string;
}

export interface Gstr2bRowError {
  sheet: string;
  row: number;
  message: string;
}

export interface Gstr2bExcelParse {
  ok: boolean;
  rows: Gstr2bRow[];
  returnPeriod: string | null;
  recipientGstin: string | null;
  sections: Gstr2bSheetReport[];
  errors: Gstr2bRowError[];
  duplicatesSkipped: number;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

type Kind = 'b2b' | 'b2ba' | 'cdnr' | 'cdnra' | 'isd' | 'isda' | 'impg' | 'impga' | 'impgsez' | 'impgseza' | 'summary' | 'eco' | 'unknown';

function normHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/₹|\(rs\.?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sheetKind(name: string): Kind {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!n || n === 'readme' || n === 'instructions') return 'summary';
  if (n.includes('itcavailable') || n.includes('itcunavailable') || n.includes('itcsummary') || n === 'summary') return 'summary';
  if (n.includes('read') && n.includes('me')) return 'summary';
  if (n === 'ecoa' || n === 'eco') return 'eco';
  if (n.includes('impgseza') || n === 'impgseza') return 'impgseza';
  if (n.includes('impgsez')) return 'impgsez';
  if (n === 'impga' || n.endsWith('impga')) return 'impga';
  if (n === 'impg' || n.endsWith('impg')) return 'impg';
  if (n === 'isda' || n.endsWith('isda')) return 'isda';
  if (n === 'isd' || n.endsWith('isd')) return 'isd';
  if (n.includes('cdnra')) return 'cdnra';
  if (n.includes('cdnr') || n === 'cdn') return 'cdnr';
  if (n === 'b2ba' || n.endsWith('b2ba')) return 'b2ba';
  if (n === 'b2b' || n.endsWith('b2b')) return 'b2b';
  return 'unknown';
}

function docType(kind: Kind, noteType: string): Gstr2bDocType {
  if (kind === 'isd' || kind === 'isda') return 'isd';
  if (kind === 'impg' || kind === 'impga' || kind === 'impgsez' || kind === 'impgseza') return 'import_goods';
  if (kind === 'cdnr' || kind === 'cdnra') {
    const t = noteType.toLowerCase();
    if (t.startsWith('d') || t.includes('debit')) return 'debit_note';
    return 'credit_note';
  }
  return 'invoice';
}

function amended(kind: Kind): boolean {
  return kind === 'b2ba' || kind === 'cdnra' || kind === 'isda' || kind === 'impga' || kind === 'impgseza';
}

interface CellRead {
  text: string;
  formula: boolean;
  date: Date | null;
  number: number | null;
}

function readCell(cell: ExcelJS.Cell): CellRead {
  const value = cell.value;
  if (value == null || value === '') return { text: '', formula: false, date: null, number: null };
  if (value instanceof Date) {
    return { text: isoDate(value), formula: false, date: value, number: null };
  }
  if (typeof value === 'number') {
    return { text: String(cell.text || value).trim(), formula: false, date: null, number: value };
  }
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      return { text: '', formula: true, date: null, number: null };
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return { text: value.richText.map((part) => part.text).join('').trim(), formula: false, date: null, number: null };
    }
    if ('text' in value && value.text != null) {
      return { text: String(value.text).trim(), formula: false, date: null, number: null };
    }
    if ('result' in value && (typeof value.result === 'number' || typeof value.result === 'string')) {
      return { text: String(value.result).trim(), formula: true, date: null, number: typeof value.result === 'number' ? value.result : null };
    }
  }
  return { text: String(value).trim(), formula: false, date: null, number: null };
}

function isoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function realCalendarDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseFlexibleDate(text: string, date: Date | null, serial: number | null): string | null {
  if (date && !Number.isNaN(date.getTime())) return isoDate(date);
  if (serial != null && serial > 20000 && serial < 80000) {
    return isoDate(new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000));
  }
  const portal = normalizePortalDate(text);
  if (portal && realCalendarDate(portal)) return portal;
  const named = /^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{4})$/.exec(text.trim());
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) {
      const iso = `${named[3]}-${month}-${named[1].padStart(2, '0')}`;
      if (realCalendarDate(iso)) return iso;
    }
  }
  return null;
}

function parsePeriod(text: string): string | null {
  const s = text.trim();
  const monthYear = /^(0[1-9]|1[0-2])(20\d{2})$/.exec(s);
  if (monthYear) return `${monthYear[2]}-${monthYear[1]}`;
  const yearMonth = /^(20\d{2})(0[1-9]|1[0-2])$/.exec(s);
  if (yearMonth) return `${yearMonth[1]}-${yearMonth[2]}`;
  const dashed = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(s);
  if (dashed) return `${dashed[1]}-${dashed[2]}`;
  const named = /^([A-Za-z]{3,9})[-\s]+(20\d{2})$/.exec(s);
  if (named) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
    if (month) return `${named[2]}-${month}`;
  }
  return null;
}

const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/;

function parseAmount(cell: CellRead): { ok: true; value: number } | { ok: false } {
  if (cell.formula) return { ok: false };
  if (!cell.text && cell.number == null) return { ok: true, value: 0 };
  if (cell.number != null && !/[eE]/.test(cell.text)) return { ok: true, value: Math.round(cell.number * 100) / 100 };
  const cleaned = cell.text.replace(/,/g, '').replace(/₹/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—') return { ok: true, value: 0 };
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { ok: false };
  return { ok: true, value: Math.round(Number(cleaned) * 100) / 100 };
}

function itcOf(text: string): 'eligible' | 'ineligible' | 'blank' | 'bad' {
  const t = text.trim().toLowerCase();
  if (!t) return 'blank';
  if (t === 'n' || t === 'no' || t.includes('not available') || t.includes('unavailable') || t.includes('ineligible')) return 'ineligible';
  if (t === 'y' || t === 'yes' || t.includes('available')) return 'eligible';
  return 'bad';
}

function revOf(text: string): 'Y' | 'N' | 'bad' {
  const t = text.trim().toLowerCase();
  if (!t) return 'N';
  if (t === 'y' || t === 'yes') return 'Y';
  if (t === 'n' || t === 'no') return 'N';
  return 'bad';
}

function stateCode(text: string): string | null {
  const digits = text.match(/\b(\d{2})\b/);
  if (digits) return digits[1];
  const compact = text.trim();
  return /^\d{2}$/.test(compact) ? compact : null;
}

type Col = 'gstin' | 'name' | 'number' | 'date' | 'noteType' | 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess' | 'itc' | 'reason' | 'rev' | 'pos' | 'originalNumber' | 'originalDate' | 'port';

const ALIASES: { col: Col; test: (h: string) => boolean }[] = [
  { col: 'gstin', test: (h) => h.includes('gstin of supplier') || h.includes('supplier gstin') || h === 'gstin of isd' || h.includes('gstin of the supplier') },
  { col: 'name', test: (h) => h.includes('trade legal') || h.includes('legal name') || h.includes('trade name') || h === 'supplier name' },
  { col: 'originalNumber', test: (h) => h.startsWith('original') && (h.includes('number') || h.includes('no')) },
  { col: 'originalDate', test: (h) => h.startsWith('original') && h.includes('date') },
  { col: 'noteType', test: (h) => h === 'note type' || h === 'document type' || h.includes('note supply type') },
  { col: 'number', test: (h) => h === 'invoice number' || h === 'invoice no' || h === 'note number' || h === 'note no' || h === 'document number' || h.includes('bill of entry number') || h === 'boe number' || h.includes('isd document number') },
  { col: 'date', test: (h) => h === 'invoice date' || h === 'note date' || h === 'document date' || h.includes('bill of entry date') || h === 'boe date' || h.includes('isd document date') },
  { col: 'taxable', test: (h) => h.startsWith('taxable value') },
  { col: 'igst', test: (h) => h.startsWith('integrated tax') || h === 'igst' },
  { col: 'cgst', test: (h) => h.startsWith('central tax') || h === 'cgst' },
  { col: 'sgst', test: (h) => h.startsWith('state ut tax') || h.startsWith('state tax') || h === 'sgst' },
  { col: 'cess', test: (h) => h === 'cess' || h.startsWith('cess ') },
  { col: 'itc', test: (h) => h.includes('itc availability') || h.includes('itc available') || h.includes('eligibility for itc') },
  { col: 'reason', test: (h) => h === 'reason' },
  { col: 'rev', test: (h) => h.includes('reverse charge') },
  { col: 'pos', test: (h) => h.includes('place of supply') },
  { col: 'port', test: (h) => h === 'port code' || h.startsWith('port code') },
];

function headerHits(cells: string[]): number {
  const headers = cells.map(normHeader).filter(Boolean);
  let hits = 0;
  for (const alias of ALIASES) {
    if (headers.some(alias.test)) hits += 1;
  }
  return hits;
}

function mapHeaders(top: string[], bottom: string[] | null): Map<Col, number> {
  const width = Math.max(top.length, bottom?.length || 0);
  const found: { col: Col; index: number; label: string }[] = [];
  for (let i = 0; i < width; i += 1) {
    const child = normHeader(bottom?.[i] || '');
    const parent = normHeader(top[i] || '');
    const label = child || parent;
    if (!label || label === 'invoice details' || label === 'tax amount' || label === 'note details') continue;
    for (const alias of ALIASES) {
      if (alias.test(label)) found.push({ col: alias.col, index: i, label });
    }
  }
  const map = new Map<Col, number>();
  for (const hit of found) {
    if (hit.col !== 'number' && !map.has(hit.col)) map.set(hit.col, hit.index);
  }
  const numbers = found.filter((hit) => hit.col === 'number');
  const note = numbers.find((hit) => /note|document|bill of entry|boe/.test(hit.label));
  const invoice = numbers.find((hit) => hit.label.includes('invoice'));
  if (note) {
    map.set('number', note.index);
    if (invoice && !map.has('originalNumber')) map.set('originalNumber', invoice.index);
  } else if (invoice) {
    map.set('number', invoice.index);
  } else if (numbers[0]) {
    map.set('number', numbers[0].index);
  }
  return map;
}

function requiredColumns(kind: Kind): Col[] {
  const base: Col[] = ['number', 'date', 'taxable'];
  if (kind === 'impg' || kind === 'impga') return ['number', 'date', 'taxable', 'igst'];
  if (kind === 'isd' || kind === 'isda') return ['gstin', 'number', 'date'];
  return ['gstin', ...base];
}

interface Draft extends Gstr2bRow {
  fingerprints: string[];
}

export async function parseGstr2bExcel(bytes: Buffer): Promise<Gstr2bExcelParse> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    return { ok: false, rows: [], returnPeriod: null, recipientGstin: null, sections: [], errors: [{ sheet: '', row: 0, message: 'The file is not a readable Excel workbook.' }], duplicatesSkipped: 0 };
  }

  const sections: Gstr2bSheetReport[] = [];
  const errors: Gstr2bRowError[] = [];
  const drafts = new Map<string, Draft>();
  let duplicatesSkipped = 0;
  let returnPeriod: string | null = null;
  let recipientGstin: string | null = null;
  let sawSupplierSheet = false;
  let sawRecipientOnly = false;

  workbook.eachSheet((sheet) => {
    const kind = sheetKind(sheet.name);
    const matrix: CellRead[][] = [];
    const rowNumbers: number[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: CellRead[] = [];
      const max = Math.max(row.cellCount, 40);
      for (let c = 1; c <= max; c += 1) cells.push(readCell(row.getCell(c)));
      if (cells.every((cell) => !cell.text && cell.number == null)) return;
      matrix.push(cells);
      rowNumbers.push(rowNumber);
    });

    if (kind === 'summary') {
      sections.push({ sheet: sheet.name, status: 'skipped', documents: 0, reason: 'Summary or instructions, not a document list.' });
      captureMeta(matrix, (period, gstin) => {
        returnPeriod = returnPeriod || period;
        recipientGstin = recipientGstin || gstin;
      });
      return;
    }
    if (kind === 'eco') {
      sections.push({ sheet: sheet.name, status: 'skipped', documents: 0, reason: 'E-commerce documents are not imported. Use the B2B, CDNR, ISD and import sheets.' });
      return;
    }
    if (kind === 'unknown') {
      sections.push({ sheet: sheet.name, status: 'skipped', documents: 0, reason: 'Unrecognized sheet. It was not imported.' });
      captureMeta(matrix, (period, gstin) => {
        returnPeriod = returnPeriod || period;
        recipientGstin = recipientGstin || gstin;
      });
      return;
    }

    let headerAt = -1;
    for (let i = 0; i < Math.min(matrix.length, 25); i += 1) {
      if (headerHits(matrix[i].map((cell) => cell.text)) >= 3) {
        headerAt = i;
        break;
      }
    }
    if (headerAt < 0) {
      const blob = matrix.flat().map((cell) => normHeader(cell.text)).join(' ');
      if (blob.includes('recipient') && !blob.includes('supplier')) sawRecipientOnly = true;
      sections.push({ sheet: sheet.name, status: 'rejected', documents: 0, reason: 'No GSTR-2B column headers were found on this sheet.' });
      errors.push({ sheet: sheet.name, row: 0, message: 'No GSTR-2B column headers were found on this sheet.' });
      return;
    }

    captureMeta(matrix.slice(0, headerAt), (period, gstin) => {
      returnPeriod = returnPeriod || period;
      recipientGstin = recipientGstin || gstin;
    });

    const top = matrix[headerAt].map((cell) => cell.text);
    const next = matrix[headerAt + 1];
    const nextIsHeader = next && headerHits(next.map((cell) => cell.text)) >= 2;
    const headers = mapHeaders(top, nextIsHeader ? next.map((cell) => cell.text) : null);
    const dataStart = headerAt + (nextIsHeader ? 2 : 1);
    const joined = [...top, ...(nextIsHeader ? next.map((cell) => cell.text) : [])].map(normHeader).join(' ');
    if (joined.includes('recipient') && !headers.has('gstin')) sawRecipientOnly = true;
    else sawSupplierSheet = true;

    const missing = requiredColumns(kind).filter((col) => !headers.has(col));
    if (amended(kind) && !headers.has('originalNumber')) missing.push('originalNumber');
    if (missing.length) {
      sections.push({ sheet: sheet.name, status: 'rejected', documents: 0, reason: `Missing columns: ${missing.join(', ')}.` });
      errors.push({ sheet: sheet.name, row: rowNumbers[headerAt] || 0, message: `Missing columns: ${missing.join(', ')}.` });
      return;
    }

    let documents = 0;
    for (let i = dataStart; i < matrix.length; i += 1) {
      const line = matrix[i];
      const excelRow = rowNumbers[i];
      const textAt = (col: Col) => line[headers.get(col) ?? -1]?.text?.trim() || '';
      const cellAt = (col: Col): CellRead => line[headers.get(col) ?? -1] || { text: '', formula: false, date: null, number: null };
      if (line.every((cell) => !cell.text && cell.number == null)) continue;
      const label = textAt('number').toLowerCase();
      if (!label && line.some((cell) => /^total$/i.test(cell.text))) continue;
      if (label === 'invoice number' || label === 'note number' || label === 'total') continue;

      const numberCell = cellAt('number');
      if (numberCell.formula) {
        errors.push({ sheet: sheet.name, row: excelRow, message: 'The document number is a formula. Enter the number as text.' });
        continue;
      }
      let invoiceNumber = numberCell.text.trim();
      if (/e\+\d+/i.test(invoiceNumber)) {
        errors.push({ sheet: sheet.name, row: excelRow, message: `Document number ${invoiceNumber} was stored as a scientific number. Format that column as text so leading digits are kept.` });
        continue;
      }
      const port = textAt('port');
      if ((kind === 'impg' || kind === 'impga' || kind === 'impgsez' || kind === 'impgseza') && port) {
        invoiceNumber = [port, invoiceNumber].filter(Boolean).join('/');
      }
      if (!invoiceNumber) {
        errors.push({ sheet: sheet.name, row: excelRow, message: 'Document number is missing.' });
        continue;
      }
      if (invoiceNumber.length > 50) {
        errors.push({ sheet: sheet.name, row: excelRow, message: 'Document number is longer than 50 characters.' });
        continue;
      }

      const dateCell = cellAt('date');
      if (dateCell.formula) {
        errors.push({ sheet: sheet.name, row: excelRow, message: 'The document date is a formula.' });
        continue;
      }
      const invoiceDate = parseFlexibleDate(dateCell.text, dateCell.date, dateCell.number);
      if (!invoiceDate) {
        errors.push({ sheet: sheet.name, row: excelRow, message: `Document date "${dateCell.text || ''}" is not a date.` });
        continue;
      }

      const gstin = textAt('gstin').toUpperCase().replace(/\s/g, '');
      const needsGstin = kind !== 'impg' && kind !== 'impga';
      if (needsGstin && !GSTIN_RE.test(gstin)) {
        errors.push({ sheet: sheet.name, row: excelRow, message: gstin ? `Supplier GSTIN ${gstin} is not valid.` : 'Supplier GSTIN is missing.' });
        continue;
      }

      const amounts: Record<'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess', number> = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      let amountBad = false;
      for (const col of ['taxable', 'igst', 'cgst', 'sgst', 'cess'] as const) {
        if (!headers.has(col)) continue;
        const parsed = parseAmount(cellAt(col));
        if (!parsed.ok) {
          errors.push({ sheet: sheet.name, row: excelRow, message: `${col} is not a number${cellAt(col).formula ? ' (the cell is a formula)' : ''}.` });
          amountBad = true;
        } else amounts[col] = parsed.value;
      }
      if (amountBad) continue;

      const itc = itcOf(textAt('itc'));
      if (itc === 'bad') {
        errors.push({ sheet: sheet.name, row: excelRow, message: `ITC availability "${textAt('itc')}" is not Yes or No.` });
        continue;
      }
      const rev = revOf(textAt('rev'));
      if (rev === 'bad') {
        errors.push({ sheet: sheet.name, row: excelRow, message: `Reverse charge "${textAt('rev')}" is not Yes or No.` });
        continue;
      }

      const originalNumber = textAt('originalNumber') || null;
      const originalDateCell = cellAt('originalDate');
      const originalDate = textAt('originalDate') || originalDateCell.date
        ? parseFlexibleDate(originalDateCell.text, originalDateCell.date, originalDateCell.number)
        : null;
      if ((textAt('originalDate') || originalDateCell.date) && !originalDate) {
        errors.push({ sheet: sheet.name, row: excelRow, message: `Original document date "${originalDateCell.text}" is not a date.` });
        continue;
      }

      const row: Gstr2bRow = {
        supplier_gstin: gstin,
        supplier_name: textAt('name') || null,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        document_type: docType(kind, textAt('noteType')),
        taxable_value: kind === 'isd' || kind === 'isda' ? 0 : amounts.taxable,
        igst_amount: amounts.igst,
        cgst_amount: amounts.cgst,
        sgst_amount: amounts.sgst,
        cess_amount: amounts.cess,
        itc_eligibility: itc === 'ineligible' ? 'ineligible' : 'eligible',
        itc_reversal_type: textAt('reason') || null,
        place_of_supply: stateCode(textAt('pos')),
        reverse_charge: rev,
        original_invoice_number: amended(kind) ? originalNumber : originalNumber,
        original_invoice_date: originalDate,
      };
      const key = `${row.supplier_gstin}|${row.invoice_number}|${row.invoice_date}|${row.document_type}`;
      const fingerprint = [row.taxable_value, row.igst_amount, row.cgst_amount, row.sgst_amount, row.cess_amount].join('|');
      const existing = drafts.get(key);
      if (!existing) {
        drafts.set(key, { ...row, fingerprints: [fingerprint] });
        documents += 1;
      } else if (existing.fingerprints.includes(fingerprint)) {
        duplicatesSkipped += 1;
      } else {
        existing.taxable_value = Math.round((existing.taxable_value + row.taxable_value) * 100) / 100;
        existing.igst_amount = Math.round((existing.igst_amount + row.igst_amount) * 100) / 100;
        existing.cgst_amount = Math.round((existing.cgst_amount + row.cgst_amount) * 100) / 100;
        existing.sgst_amount = Math.round((existing.sgst_amount + row.sgst_amount) * 100) / 100;
        existing.cess_amount = Math.round((existing.cess_amount + row.cess_amount) * 100) / 100;
        if (row.itc_eligibility === 'ineligible') existing.itc_eligibility = 'ineligible';
        if (row.reverse_charge === 'Y') existing.reverse_charge = 'Y';
        existing.fingerprints.push(fingerprint);
      }
    }
    sections.push({ sheet: sheet.name, status: 'imported', documents, reason: undefined });
  });

  if (!sawSupplierSheet && sawRecipientOnly) {
    return {
      ok: false,
      rows: [],
      returnPeriod,
      recipientGstin,
      sections,
      errors: [{ sheet: '', row: 0, message: 'This looks like a GSTR-1 workbook (recipient GSTIN), not a GSTR-2B download.' }],
      duplicatesSkipped,
    };
  }
  const imported = sections.filter((section) => section.status === 'imported');
  if (imported.length === 0) {
    return {
      ok: false,
      rows: [],
      returnPeriod,
      recipientGstin,
      sections,
      errors: errors.length ? errors : [{ sheet: '', row: 0, message: 'This workbook has no GSTR-2B detail sheets (B2B, B2BA, CDNR, ISD or IMPG).' }],
      duplicatesSkipped,
    };
  }
  if (errors.length) {
    return { ok: false, rows: [], returnPeriod, recipientGstin, sections, errors, duplicatesSkipped };
  }
  const rows = [...drafts.values()].map(({ fingerprints: _fingerprints, ...row }) => row);
  return { ok: true, rows, returnPeriod, recipientGstin, sections, errors: [], duplicatesSkipped };
}

function captureMeta(rows: CellRead[][], set: (period: string | null, gstin: string | null) => void) {
  let period: string | null = null;
  let gstin: string | null = null;
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      const text = row[i].text.trim();
      const label = normHeader(text);
      const next = row[i + 1]?.text?.trim() || '';
      if (!period && (label === 'return period' || label === 'tax period' || label === 'period' || label.includes('return period'))) {
        period = parsePeriod(next) || parsePeriod(text.split(':').pop() || '');
      }
      if (!period) period = parsePeriod(text);
      const candidate = (GSTIN_RE.test(next.toUpperCase()) ? next : text).toUpperCase();
      if (!gstin && GSTIN_RE.test(candidate) && (label.includes('gstin') || GSTIN_RE.test(text.toUpperCase()))) {
        if (!label.includes('supplier')) gstin = candidate;
      }
    }
  }
  if (period || gstin) set(period, gstin);
}
