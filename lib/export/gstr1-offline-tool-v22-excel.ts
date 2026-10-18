/**
 * GSTR-1 Excel in **GST Java Offline Tool V2.2** workbook shape:
 * loads `public/gst-templates/GSTR1_Excel_Workbook_Template_V2.2.xlsx` and writes
 * data starting at row 5 (row 4 = headers — do not modify).
 *
 * Optional override: set `GSTR1_OFFLINE_TEMPLATE_PATH` to a full path of the same template.
 */

import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import type { GSTR1Filters } from '@/lib/gst/gstr1';

/**
 * The GST workbook pre-creates up to 120,000 styled rows and, on some sheets, every column out to XFC.
 * ExcelJS turns that into millions of cells and the server runs out of memory.
 * Rows 1–4 are the header. Data starts at row 5. Each sheet keeps at most 10 blank rows under that header.
 */
const TEMPLATE_MAX_COL = 32;
const HEADER_ROWS = 4;
const MAX_EMPTY_ROWS = 10;
const TEMPLATE_MAX_ROW = HEADER_ROWS + MAX_EMPTY_ROWS;

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function columnLetters(index: number): string {
  let n = index;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function clampCellRef(value: string, maxCol: number, maxRow: number): string {
  return value
    .split(/\s+/)
    .map((part) => {
      const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(part);
      if (!match) return part;
      const startCol = columnIndex(match[1]);
      const startRow = Number(match[2]);
      if (startCol > maxCol || startRow > maxRow) return '';
      if (!match[3]) return `${match[1]}${startRow}`;
      const endCol = Math.min(columnIndex(match[3]), maxCol);
      const endRow = Math.min(Number(match[4]), maxRow);
      return `${match[1]}${startRow}:${columnLetters(endCol)}${endRow}`;
    })
    .filter(Boolean)
    .join(' ');
}

function slimCells(row: string, maxCol: number): string {
  return row.replace(/<c r="([A-Z]+)(\d+)"(?:\s[^>]*?)?(?:\/>|>[\s\S]*?<\/c>)/g, (cell, letters: string) =>
    columnIndex(letters) > maxCol ? '' : cell
  );
}

export function slimWorksheetXml(xml: string, maxCol = TEMPLATE_MAX_COL, maxRow = TEMPLATE_MAX_ROW): string {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf('<row ', cursor);
    if (start === -1) {
      parts.push(xml.slice(cursor));
      break;
    }
    parts.push(xml.slice(cursor, start));
    const end = xml.indexOf('</row>', start);
    if (end === -1) {
      parts.push(xml.slice(start));
      break;
    }
    const row = xml.slice(start, end + '</row>'.length);
    const rowNumber = Number(/^<row r="(\d+)"/.exec(row)?.[1] ?? 0);
    if (rowNumber > 0 && rowNumber <= maxRow) parts.push(slimCells(row, maxCol));
    cursor = end + '</row>'.length;
  }
  const slim = parts
    .join('')
    .replace(/<col\b[^>]*\/>/g, (tag) => {
      const min = Number(/min="(\d+)"/.exec(tag)?.[1] ?? 1);
      const max = Number(/max="(\d+)"/.exec(tag)?.[1] ?? min);
      if (min > maxCol) return '';
      return max > maxCol ? tag.replace(/max="\d+"/, `max="${maxCol}"`) : tag;
    })
    .replace(/<dataValidation\b[^>]*>[\s\S]*?<\/dataValidation>/g, (tag) => {
      const sq = /sqref="([^"]*)"/.exec(tag);
      if (!sq) return tag;
      const next = clampCellRef(sq[1], maxCol, maxRow);
      if (!next) return '';
      return tag.replace(sq[0], `sqref="${next}"`);
    });
  return slim
    .replace(/spans="([^"]+)"/g, (_all, spans: string) => {
      const kept = spans
        .split(/\s+/)
        .map((part) => {
          const [start, end] = part.split(':').map(Number);
          if (!end || end <= maxCol) return part;
          if (start > maxCol) return '';
          return `${start}:${maxCol}`;
        })
        .filter(Boolean);
      return `spans="${kept[0] || `1:${maxCol}`}"`;
    })
    .replace(/<dimension ref="[^"]+"\s*\/>/, `<dimension ref="A1:AF${maxRow}"/>`);
}

async function loadTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  const JSZip = require('jszip') as {
    loadAsync(data: Buffer): Promise<{
      files: Record<string, { dir: boolean; async(type: 'nodebuffer'): Promise<Buffer> }>;
      file(name: string, data: string | Buffer): void;
      generateAsync(opts: { type: 'nodebuffer'; compression: 'DEFLATE' }): Promise<Buffer>;
    }>;
  };
  const zip = await JSZip.loadAsync(fs.readFileSync(templatePath()));
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = (await zip.files[name].async('nodebuffer')).toString('utf8');
    zip.file(name, slimWorksheetXml(xml));
  }
  const slimmed = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(slimmed as unknown as ExcelJS.Buffer);
  return workbook;
}

const DATA_START_ROW = 5;

function formatDateForGSTN(dateStr: string | Date): string {
  if (!dateStr) return '';
  if (typeof dateStr === 'string') {
    const dmy = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) return `${dmy[1].padStart(2, '0')}/${dmy[2].padStart(2, '0')}/${dmy[3]}`;
  }
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (isNaN(date.getTime())) return '';
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/** 2-digit state/UT code for POS column */
function posShort(placeOfSupply: string | undefined | null): string {
  if (!placeOfSupply) return '';
  const s = String(placeOfSupply).trim();
  if (s.includes('-')) return s.split('-')[0].trim().substring(0, 2);
  return s.substring(0, 2);
}

function b2csTy(type: string): 'E' | 'OE' {
  return type === 'E-Commerce' || type === 'E' ? 'E' : 'OE';
}

function validEtin(g: string | null | undefined): string {
  const t = (g || '').trim().toUpperCase();
  return t.length === 15 ? t : '';
}

function isRegCdn(c: { gstin_uin_recipient?: string | null }): boolean {
  const g = (c.gstin_uin_recipient || '').trim();
  return g.length === 15;
}

function templatePath(): string {
  const env = process.env.GSTR1_OFFLINE_TEMPLATE_PATH;
  if (env && fs.existsSync(env)) return env;
  const p = path.join(
    process.cwd(),
    'public',
    'gst-templates',
    'GSTR1_Excel_Workbook_Template_V2.2.xlsx'
  );
  if (fs.existsSync(p)) return p;
  throw new Error(
    'GSTR-1 offline template missing. Place GSTR1_Excel_Workbook_Template_V2.2.xlsx in public/gst-templates/ or set GSTR1_OFFLINE_TEMPLATE_PATH.'
  );
}

/** Report shape from GSTR1Generator.generate() */
export type Gstr1OfflineReport = {
  b2b: Array<{
    gstin: string;
    receiver_name?: string;
    invoice_number: string;
    invoice_date: string;
    invoice_value: number;
    place_of_supply: string;
    reverse_charge: string;
    invoice_type: string;
    ecommerce_gstin: string | null;
    rate: number;
    taxable_value: number;
    cess_amount?: number;
  }>;
  b2cl: Array<{
    invoice_number: string;
    invoice_date: string;
    invoice_value: number;
    place_of_supply: string;
    rate: number;
    taxable_value: number;
    cess_amount?: number;
    ecommerce_gstin: string | null;
  }>;
  b2cs: Array<{
    type: string;
    place_of_supply: string;
    rate: number;
    taxable_value: number;
    cess_amount?: number;
    ecommerce_gstin: string | null;
  }>;
  exports: Array<{
    export_type: string;
    invoice_number: string;
    invoice_date: string;
    invoice_value: number;
    port_code: string | null;
    shipping_bill_number: string | null;
    shipping_bill_date: string | null;
    rate: number;
    taxable_value: number;
    cess_amount?: number;
  }>;
  sez: Array<{
    sez_unit_gstin: string;
    invoice_number: string;
    invoice_date: string;
    invoice_value: number;
    place_of_supply: string;
    sez_type: string;
    rate: number;
    taxable_value: number;
    cess_amount?: number;
  }>;
  hsn: Array<{
    hsn_sac: string;
    description: string;
    uqc: string;
    total_quantity: number;
    total_value: number;
    taxable_value: number;
    integrated_tax: number;
    central_tax: number;
    state_ut_tax: number;
    cess_amount?: number;
    rate?: number;
  }>;
  nil: Array<{
    description: string;
    nil_supply: number;
    exempt_supply: number;
    non_gst_supply: number;
  }>;
  cdn: Array<{
    gstin_uin_recipient?: string | null;
    receiver_name?: string | null;
    note_number: string;
    note_date: string;
    note_type: 'C' | 'D';
    place_of_supply: string;
    invoice_value: number;
    original_invoice_number?: string | null;
    original_invoice_date?: string | null;
    note_supply_type?: string;
    reverse_charge?: 'Y' | 'N';
    cdnur_typ?: string | null;
    tax_rate: number;
    taxable_value: number;
    igst_amount?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    cess_amount?: number;
  }>;
  doc_issue_summary?: {
    from: string;
    to: string;
    totnum: number;
    cancel: number;
  } | null;
};

function rowHasValue(row: ExcelJS.Row): boolean {
  const values = row.values as Array<ExcelJS.CellValue | undefined>;
  return values.some((value, index) => index > 0 && value !== null && value !== undefined && value !== '');
}

function clearTemplateDataRows(workbook: ExcelJS.Workbook) {
  for (const ws of workbook.worksheets) {
    for (let n = DATA_START_ROW; n <= Math.min(ws.rowCount, TEMPLATE_MAX_ROW); n++) {
      ws.getRow(n).eachCell({ includeEmpty: false }, (cell) => {
        cell.value = null;
      });
    }
  }
}

function trimSheets(workbook: ExcelJS.Workbook) {
  for (const ws of workbook.worksheets) {
    let last = HEADER_ROWS;
    ws.eachRow((row, n) => {
      if (rowHasValue(row) && n > last) last = n;
    });
    const limit = Math.max(last, HEADER_ROWS + MAX_EMPTY_ROWS);
    if (ws.rowCount > limit) ws.spliceRows(limit + 1, ws.rowCount - limit);
  }
}

function setRowCells(ws: ExcelJS.Worksheet, rowIndex: number, values: (string | number | null | undefined)[]) {
  const row = ws.getRow(rowIndex);
  values.forEach((v, i) => {
    const cell = row.getCell(i + 1);
    if (v === '' || v === null || v === undefined) cell.value = null;
    else cell.value = v as ExcelJS.CellValue;
  });
}

/**
 * Fill official GST offline tool workbook (V2.2 template) for Import → Generate JSON.
 */
export async function generateGstr1OfflineToolV22Excel(
  report: Gstr1OfflineReport,
  _filters: GSTR1Filters,
  _businessStateCode: string,
  _businessGstin: string
): Promise<Buffer> {
  const workbook = await loadTemplateWorkbook();
  clearTemplateDataRows(workbook);

  // ─── b2b,sez,de (A–M) ─────────────────────────────────────────────────────
  const wsB2b = workbook.getWorksheet('b2b,sez,de');
  if (!wsB2b) throw new Error('Worksheet "b2b,sez,de" not found in template');
  let r = DATA_START_ROW;
  for (const item of report.b2b) {
    const et = validEtin(item.ecommerce_gstin);
    setRowCells(wsB2b, r++, [
      item.gstin || '',
      item.receiver_name || '',
      item.invoice_number || '',
      formatDateForGSTN(item.invoice_date),
      Math.round(item.invoice_value * 100) / 100,
      posShort(item.place_of_supply),
      item.reverse_charge || 'N',
      '', // Applicable % of Tax Rate
      item.invoice_type || 'Regular',
      et,
      item.rate,
      Math.round(item.taxable_value * 100) / 100,
      Math.round((item.cess_amount || 0) * 100) / 100,
    ]);
  }
  for (const item of report.sez) {
    const invTyp =
      item.sez_type === 'WPAY' ? 'SEZ supplies with payment' : 'SEZ supplies without payment';
    setRowCells(wsB2b, r++, [
      item.sez_unit_gstin || '',
      '',
      item.invoice_number || '',
      formatDateForGSTN(item.invoice_date),
      Math.round(item.invoice_value * 100) / 100,
      posShort(item.place_of_supply),
      'N',
      '',
      invTyp,
      '',
      item.rate,
      Math.round(item.taxable_value * 100) / 100,
      Math.round((item.cess_amount || 0) * 100) / 100,
    ]);
  }

  // ─── b2cl (A–I) ───────────────────────────────────────────────────────────
  const wsB2cl = workbook.getWorksheet('b2cl');
  if (wsB2cl) {
    r = DATA_START_ROW;
    for (const item of report.b2cl) {
      const et = validEtin(item.ecommerce_gstin);
      setRowCells(wsB2cl, r++, [
        item.invoice_number || '',
        formatDateForGSTN(item.invoice_date),
        Math.round(item.invoice_value * 100) / 100,
        posShort(item.place_of_supply),
        '',
        item.rate,
        Math.round(item.taxable_value * 100) / 100,
        Math.round((item.cess_amount || 0) * 100) / 100,
        et,
      ]);
    }
  }

  // ─── b2cs (A–G): Type, POS, Applicable %, Rate, Taxable, Cess, E-comm GSTIN ─
  const wsB2cs = workbook.getWorksheet('b2cs');
  if (wsB2cs) {
    r = DATA_START_ROW;
    for (const item of report.b2cs) {
      const ty = b2csTy(item.type);
      const et = ty === 'E' ? validEtin(item.ecommerce_gstin) : '';
      setRowCells(wsB2cs, r++, [
        ty,
        posShort(item.place_of_supply),
        '',
        item.rate,
        Math.round(item.taxable_value * 100) / 100,
        Math.round((item.cess_amount || 0) * 100) / 100,
        et,
      ]);
    }
  }

  // ─── cdnr (A–M) ─────────────────────────────────────────────────────────────
  const wsCdnr = workbook.getWorksheet('cdnr');
  if (wsCdnr) {
    r = DATA_START_ROW;
    for (const item of report.cdn.filter(isRegCdn)) {
      setRowCells(wsCdnr, r++, [
        (item.gstin_uin_recipient || '').trim(),
        item.receiver_name || '',
        item.note_number || '',
        formatDateForGSTN(item.note_date),
        item.note_type || 'C',
        posShort(item.place_of_supply),
        item.reverse_charge || 'N',
        item.note_supply_type || 'Regular',
        Math.round(item.invoice_value * 100) / 100,
        '',
        item.tax_rate,
        Math.round(item.taxable_value * 100) / 100,
        Math.round((item.cess_amount || 0) * 100) / 100,
      ]);
    }
  }

  // ─── cdnur (A–J) ────────────────────────────────────────────────────────────
  const wsCdnur = workbook.getWorksheet('cdnur');
  if (wsCdnur) {
    r = DATA_START_ROW;
    for (const item of report.cdn.filter((c) => !isRegCdn(c))) {
      setRowCells(wsCdnur, r++, [
        item.cdnur_typ || 'B2CL',
        item.note_number || '',
        formatDateForGSTN(item.note_date),
        item.note_type || 'C',
        posShort(item.place_of_supply),
        Math.round(item.invoice_value * 100) / 100,
        '',
        item.tax_rate,
        Math.round(item.taxable_value * 100) / 100,
        Math.round((item.cess_amount || 0) * 100) / 100,
      ]);
    }
  }

  // ─── exp (A–J) ──────────────────────────────────────────────────────────────
  const wsExp = workbook.getWorksheet('exp');
  if (wsExp) {
    r = DATA_START_ROW;
    for (const item of report.exports) {
      const exTyp = item.export_type === 'WPAY' || item.export_type === 'WOPAY' ? item.export_type : 'WOPAY';
      setRowCells(wsExp, r++, [
        exTyp,
        item.invoice_number || '',
        formatDateForGSTN(item.invoice_date),
        Math.round(item.invoice_value * 100) / 100,
        item.port_code || '',
        item.shipping_bill_number || '',
        item.shipping_bill_date ? formatDateForGSTN(item.shipping_bill_date) : '',
        item.rate,
        Math.round(item.taxable_value * 100) / 100,
        Math.round((item.cess_amount || 0) * 100) / 100,
      ]);
    }
  }

  // ─── hsn(b2b) (A–K) — all HSN rows here; hsn(b2c) left empty ───────────────
  const wsHsnB2b = workbook.getWorksheet('hsn(b2b)');
  if (wsHsnB2b) {
    r = DATA_START_ROW;
    for (const item of report.hsn) {
      setRowCells(wsHsnB2b, r++, [
        item.hsn_sac || 'NA',
        item.description || '',
        item.uqc || 'NOS',
        Math.round(item.total_quantity * 100) / 100,
        Math.round(item.total_value * 100) / 100,
        item.rate ?? 0,
        Math.round(item.taxable_value * 100) / 100,
        Math.round((item.integrated_tax || 0) * 100) / 100,
        Math.round((item.central_tax || 0) * 100) / 100,
        Math.round((item.state_ut_tax || 0) * 100) / 100,
        Math.round((item.cess_amount || 0) * 100) / 100,
      ]);
    }
  }

  // ─── exemp ─────────────────────────────────────────────────────────────────
  const wsExemp = workbook.getWorksheet('exemp');
  if (wsExemp) {
    r = DATA_START_ROW;
    for (const item of report.nil) {
      setRowCells(wsExemp, r++, [
        item.description || '',
        Math.round((item.nil_supply || 0) * 100) / 100,
        Math.round((item.exempt_supply || 0) * 100) / 100,
        Math.round((item.non_gst_supply || 0) * 100) / 100,
      ]);
    }
  }

  // ─── docs ──────────────────────────────────────────────────────────────────
  const wsDocs = workbook.getWorksheet('docs');
  if (wsDocs && report.doc_issue_summary && report.doc_issue_summary.totnum > 0) {
    const d = report.doc_issue_summary;
    setRowCells(wsDocs, DATA_START_ROW, [
      'Invoices for outward supply',
      d.from,
      d.to,
      d.totnum,
      d.cancel ?? 0,
    ]);
  }

  trimSheets(workbook);
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
