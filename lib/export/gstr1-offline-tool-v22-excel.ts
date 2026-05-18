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

const DATA_START_ROW = 5;

function formatDateForGSTN(dateStr: string | Date): string {
  if (!dateStr) return '';
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
  const tp = templatePath();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(tp);

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

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
