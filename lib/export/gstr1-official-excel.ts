import ExcelJS from 'exceljs';
import { GSTR1Filters } from '@/lib/gst/gstr1';

// GSTR1 Report data structure
interface GSTR1Report {
  summary: {
    total_outward_taxable_supplies: number;
    total_tax_amount: number;
    invoice_count: number;
    b2b_count: number;
    b2cl_count: number;
    b2cs_count: number;
  };
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
    igst_amount: number;
    cgst_amount: number;
    sgst_amount: number;
    cess_amount: number;
  }>;
  b2cl: Array<{
    invoice_number: string;
    invoice_date: string;
    invoice_value: number;
    place_of_supply: string;
    rate: number;
    taxable_value: number;
    igst_amount: number;
    cess_amount: number;
    ecommerce_gstin: string | null;
  }>;
  b2cs: Array<{
    type: string;
    place_of_supply: string;
    rate: number;
    taxable_value: number;
    igst_amount: number;
    cgst_amount: number;
    sgst_amount: number;
    cess_amount: number;
    ecommerce_gstin: string | null;
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
    cess_amount: number;
    rate?: number;
  }>;
  nil: Array<{
    description: string;
    nil_supply: number;
    exempt_supply: number;
    non_gst_supply: number;
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
    igst_amount: number;
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
    igst_amount: number;
    cess_amount: number;
  }>;
  cdn: Array<{
    gstin_uin_recipient: string | null;
    receiver_name: string | null;
    note_number: string;
    note_date: string;
    note_type: 'C' | 'D';
    place_of_supply: string;
    invoice_value: number;
    original_invoice_number: string | null;
    original_invoice_date: string | null;
    note_supply_type: string;
    reverse_charge?: 'Y' | 'N';
    cdnur_typ?: 'B2CL' | 'EXPWP' | 'EXPWOP' | null;
    tax_rate: number;
    taxable_value: number;
    igst_amount: number;
    cgst_amount: number;
    sgst_amount: number;
    cess_amount: number;
  }>;
}

/**
 * Format date to DD/MM/YYYY string format (required by GSTN)
 */
function formatDateForGSTN(dateStr: string | Date): string {
  if (!dateStr) return '';
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (isNaN(date.getTime())) return '';
  
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}



/**
 * Generate official GSTN-compliant Excel file for GSTR-1
 * Matches GSTR1_Excel_Workbook_Template_V2.2.xlsx structure exactly
 */
export async function generateOfficialGSTR1Excel(
  report: GSTR1Report,
  filters: GSTR1Filters,
  businessStateCode: string = '',
  businessGstin: string = ''
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  
  // Create all required sheets in exact order as per GSTN template
  
  // ============================================
  // SHEET 1: B2B
  // ============================================
  const b2bSheet = workbook.addWorksheet('B2B');
  b2bSheet.columns = [
    { header: 'GSTIN/UIN of Recipient', key: 'gstin', width: 18 },
    { header: 'Receiver Name', key: 'receiver_name', width: 24 },
    { header: 'Invoice Number', key: 'invoice_number', width: 20 },
    { header: 'Invoice date', key: 'invoice_date', width: 12 },
    { header: 'Invoice Value', key: 'invoice_value', width: 15 },
    { header: 'Place Of Supply', key: 'place_of_supply', width: 15 },
    { header: 'Reverse Charge', key: 'reverse_charge', width: 12 },
    { header: 'Invoice Type', key: 'invoice_type', width: 15 },
    { header: 'E-Commerce GSTIN', key: 'ecommerce_gstin', width: 18 },
    { header: 'Rate', key: 'rate', width: 8 },
    { header: 'Taxable Value', key: 'taxable_value', width: 15 },
    { header: 'Integrated Tax', key: 'igst', width: 15 },
    { header: 'Central Tax', key: 'cgst', width: 15 },
    { header: 'State/UT Tax', key: 'sgst', width: 15 },
    { header: 'Cess Amount', key: 'cess', width: 15 },
  ];
  
  report.b2b.forEach((item) => {
    b2bSheet.addRow({
      gstin: item.gstin || '',
      receiver_name: item.receiver_name || '',
      invoice_number: item.invoice_number || '',
      invoice_date: formatDateForGSTN(item.invoice_date),
      invoice_value: Math.round(item.invoice_value * 100) / 100,
      place_of_supply: item.place_of_supply?.substring(0, 2) || '',
      reverse_charge: item.reverse_charge || 'N',
      invoice_type: item.invoice_type || 'Regular',
      ecommerce_gstin: item.ecommerce_gstin || '',
      rate: item.rate,
      taxable_value: Math.round(item.taxable_value * 100) / 100,
      igst: Math.round((item.igst_amount || 0) * 100) / 100,
      cgst: Math.round((item.cgst_amount || 0) * 100) / 100,
      sgst: Math.round((item.sgst_amount || 0) * 100) / 100,
      cess: Math.round((item.cess_amount || 0) * 100) / 100,
    });
  });
  
  // Style header
  if (b2bSheet.rowCount > 0) {
    const headerRow = b2bSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  }
  
  // ============================================
  // SHEET 2: B2BUR (B2B Unregistered - kept for template compliance)
  // ============================================
  const b2burSheet = workbook.addWorksheet('B2BUR');
  b2burSheet.columns = [
    { header: 'GSTIN/UIN of Recipient', key: 'gstin', width: 18 },
    { header: 'Invoice Number', key: 'invoice_number', width: 20 },
    { header: 'Invoice date', key: 'invoice_date', width: 12 },
    { header: 'Invoice Value', key: 'invoice_value', width: 15 },
    { header: 'Place Of Supply', key: 'place_of_supply', width: 15 },
    { header: 'Reverse Charge', key: 'reverse_charge', width: 12 },
    { header: 'Invoice Type', key: 'invoice_type', width: 15 },
    { header: 'E-Commerce GSTIN', key: 'ecommerce_gstin', width: 18 },
    { header: 'Rate', key: 'rate', width: 8 },
    { header: 'Taxable Value', key: 'taxable_value', width: 15 },
    { header: 'Integrated Tax', key: 'igst', width: 15 },
    { header: 'Central Tax', key: 'cgst', width: 15 },
    { header: 'State/UT Tax', key: 'sgst', width: 15 },
    { header: 'Cess Amount', key: 'cess', width: 15 },
  ];
  // Empty sheet - header only (required by GSTN)
  const b2burHeaderRow = b2burSheet.getRow(1);
  b2burHeaderRow.font = { bold: true };
  b2burHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  
  // ============================================
  // SHEET 3: B2CL (B2C Large - Inter-state > 2.5L)
  // ============================================
  const b2clSheet = workbook.addWorksheet('B2CL');
  b2clSheet.columns = [
    { header: 'Invoice Number', key: 'invoice_number', width: 20 },
    { header: 'Invoice date', key: 'invoice_date', width: 12 },
    { header: 'Invoice Value', key: 'invoice_value', width: 15 },
    { header: 'Place Of Supply', key: 'place_of_supply', width: 15 },
    { header: 'Applicable % of Tax Rate', key: 'rate', width: 20 },
    { header: 'Rate', key: 'rate_val', width: 8 },
    { header: 'Taxable Value', key: 'taxable_value', width: 15 },
    { header: 'Integrated Tax', key: 'igst', width: 15 },
    { header: 'Cess Amount', key: 'cess', width: 15 },
    { header: 'E-Commerce GSTIN', key: 'ecommerce_gstin', width: 18 },
  ];
  
  report.b2cl.forEach((item) => {
    b2clSheet.addRow({
      invoice_number: item.invoice_number || '',
      invoice_date: formatDateForGSTN(item.invoice_date),
      invoice_value: Math.round(item.invoice_value * 100) / 100,
      place_of_supply: item.place_of_supply?.substring(0, 2) || '',
      rate: item.rate,
      taxable_value: Math.round(item.taxable_value * 100) / 100,
      igst: Math.round((item.igst_amount || 0) * 100) / 100,
      cess: Math.round((item.cess_amount || 0) * 100) / 100,
      ecommerce_gstin: item.ecommerce_gstin || '',
    });
  });
  
  if (b2clSheet.rowCount > 0) {
    const headerRow = b2clSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  }
  
  // ============================================
  // SHEET 4: B2CS (B2C Small - Aggregated)
  // ============================================
  const b2csSheet = workbook.addWorksheet('B2CS');
  b2csSheet.columns = [
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Place Of Supply', key: 'place_of_supply', width: 15 },
    { header: 'Rate', key: 'rate', width: 8 },
    { header: 'Taxable Value', key: 'taxable_value', width: 15 },
    { header: 'Integrated Tax', key: 'igst', width: 15 },
    { header: 'Central Tax', key: 'cgst', width: 15 },
    { header: 'State/UT Tax', key: 'sgst', width: 15 },
    { header: 'Cess Amount', key: 'cess', width: 15 },
    { header: 'E-Commerce GSTIN', key: 'ecommerce_gstin', width: 18 },
  ];
  
  report.b2cs.forEach((item) => {
    b2csSheet.addRow({
      type: item.type === 'E-Commerce' ? 'E' : 'OE',
      place_of_supply: item.place_of_supply?.substring(0, 2) || '',
      rate: item.rate,
      taxable_value: Math.round(item.taxable_value * 100) / 100,
      igst: Math.round((item.igst_amount || 0) * 100) / 100,
      cgst: Math.round((item.cgst_amount || 0) * 100) / 100,
      sgst: Math.round((item.sgst_amount || 0) * 100) / 100,
      cess: Math.round((item.cess_amount || 0) * 100) / 100,
      ecommerce_gstin: item.ecommerce_gstin || '',
    });
  });
  
  if (b2csSheet.rowCount > 0) {
    const headerRow = b2csSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  }
  
  // ============================================
  // SHEET 5: CDNR (Credit/Debit Notes - B2B)
  // ============================================
  const cdnrSheet = workbook.addWorksheet('CDNR');
  cdnrSheet.columns = [
    { header: 'GSTIN/UIN of Recipient', key: 'gstin', width: 18 },
    { header: 'Note Number', key: 'note_number', width: 20 },
    { header: 'Note date', key: 'note_date', width: 12 },
    { header: 'Note Type', key: 'note_type', width: 12 },
    { header: 'Place Of Supply', key: 'place_of_supply', width: 15 },
    { header: 'Note Supply Type', key: 'note_supply_type', width: 18 },
    { header: 'Note Value', key: 'note_value', width: 15 },
    { header: 'Applicable % of Tax Rate', key: 'rate', width: 20 },
    { header: 'Taxable Value', key: 'taxable_value', width: 15 },
    { header: 'Integrated Tax', key: 'igst', width: 15 },
    { header: 'Central Tax', key: 'cgst', width: 15 },
    { header: 'State/UT Tax', key: 'sgst', width: 15 },
    { header: 'Cess Amount', key: 'cess', width: 15 },
    { header: 'Original Invoice Number', key: 'original_invoice_number', width: 20 },
    { header: 'Original Invoice date', key: 'original_invoice_date', width: 15 },
    { header: 'E-Commerce GSTIN', key: 'ecommerce_gstin', width: 18 },
  ];
  
  const isRegCdn = (c: GSTR1Report['cdn'][0]) =>
    !!c.gstin_uin_recipient && String(c.gstin_uin_recipient).trim().length === 15;

  // Filter CDN entries for B2B (valid 15-char GSTIN)
  report.cdn.filter(isRegCdn).forEach((item) => {
    cdnrSheet.addRow({
      gstin: item.gstin_uin_recipient || '',
      note_number: item.note_number || '',
      note_date: formatDateForGSTN(item.note_date),
      note_type: item.note_type || 'C',
      place_of_supply: item.place_of_supply?.substring(0, 2) || '',
      note_supply_type: item.note_supply_type || 'Regular',
      note_value: Math.round(item.invoice_value * 100) / 100,
      rate: item.tax_rate,
      taxable_value: Math.round(item.taxable_value * 100) / 100,
      igst: Math.round((item.igst_amount || 0) * 100) / 100,
      cgst: Math.round((item.cgst_amount || 0) * 100) / 100,
      sgst: Math.round((item.sgst_amount || 0) * 100) / 100,
      cess: Math.round((item.cess_amount || 0) * 100) / 100,
      original_invoice_number: item.original_invoice_number || '',
      original_invoice_date: item.original_invoice_date ? formatDateForGSTN(item.original_invoice_date) : '',
      ecommerce_gstin: '',
    });
  });
  
  if (cdnrSheet.rowCount > 0) {
    const headerRow = cdnrSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  }
  
  // ============================================
  // SHEET 6: CDNUR (Credit/Debit Notes - B2C/Unregistered)
  // ============================================
  const cdnurSheet = workbook.addWorksheet('CDNUR');
  cdnurSheet.columns = [
    { header: 'UR Type', key: 'ur_type', width: 15 },
    { header: 'Note Number', key: 'note_number', width: 20 },
    { header: 'Note date', key: 'note_date', width: 12 },
    { header: 'Note Type', key: 'note_type', width: 12 },
    { header: 'Place Of Supply', key: 'place_of_supply', width: 15 },
    { header: 'Note Supply Type', key: 'note_supply_type', width: 18 },
    { header: 'Note Value', key: 'note_value', width: 15 },
    { header: 'Applicable % of Tax Rate', key: 'rate', width: 20 },
    { header: 'Taxable Value', key: 'taxable_value', width: 15 },
    { header: 'Integrated Tax', key: 'igst', width: 15 },
    { header: 'Central Tax', key: 'cgst', width: 15 },
    { header: 'State/UT Tax', key: 'sgst', width: 15 },
    { header: 'Cess Amount', key: 'cess', width: 15 },
    { header: 'E-Commerce GSTIN', key: 'ecommerce_gstin', width: 18 },
  ];
  
  // Filter CDN entries for B2C/Unregistered (no / invalid GSTIN)
  report.cdn.filter(c => !isRegCdn(c)).forEach((item) => {
    cdnurSheet.addRow({
      ur_type: item.cdnur_typ || 'B2CL',
      note_number: item.note_number || '',
      note_date: formatDateForGSTN(item.note_date),
      note_type: item.note_type || 'C',
      place_of_supply: item.place_of_supply?.substring(0, 2) || '',
      note_supply_type: item.note_supply_type || 'Regular',
      note_value: Math.round(item.invoice_value * 100) / 100,
      rate: item.tax_rate,
      taxable_value: Math.round(item.taxable_value * 100) / 100,
      igst: Math.round((item.igst_amount || 0) * 100) / 100,
      cgst: Math.round((item.cgst_amount || 0) * 100) / 100,
      sgst: Math.round((item.sgst_amount || 0) * 100) / 100,
      cess: Math.round((item.cess_amount || 0) * 100) / 100,
      ecommerce_gstin: '',
    });
  });
  
  if (cdnurSheet.rowCount > 0) {
    const headerRow = cdnurSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  }
  
  // ============================================
  // SHEET 7: EXP (Exports)
  // ============================================
  const expSheet = workbook.addWorksheet('EXP');
  expSheet.columns = [
    { header: 'Export Type', key: 'export_type', width: 15 },
    { header: 'Invoice Number', key: 'invoice_number', width: 20 },
    { header: 'Invoice date', key: 'invoice_date', width: 12 },
    { header: 'Invoice Value', key: 'invoice_value', width: 15 },
    { header: 'Port Code', key: 'port_code', width: 12 },
    { header: 'Shipping Bill Number', key: 'shipping_bill_number', width: 20 },
    { header: 'Shipping Bill Date', key: 'shipping_bill_date', width: 15 },
    { header: 'Applicable % of Tax Rate', key: 'rate', width: 20 },
    { header: 'Taxable Value', key: 'taxable_value', width: 15 },
  ];
  
  report.exports.forEach((item) => {
    expSheet.addRow({
      export_type: item.export_type || 'WOPAY',
      invoice_number: item.invoice_number || '',
      invoice_date: formatDateForGSTN(item.invoice_date),
      invoice_value: Math.round(item.invoice_value * 100) / 100,
      port_code: item.port_code || '',
      shipping_bill_number: item.shipping_bill_number || '',
      shipping_bill_date: item.shipping_bill_date ? formatDateForGSTN(item.shipping_bill_date) : '',
      rate: item.rate,
      taxable_value: Math.round(item.taxable_value * 100) / 100,
    });
  });
  
  if (expSheet.rowCount > 0) {
    const headerRow = expSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  }
  
  // ============================================
  // SHEET 8: SEZ (Special Economic Zone Supplies)
  // ============================================
  const sezSheet = workbook.addWorksheet('SEZ');
  sezSheet.columns = [
    { header: 'GSTIN of SEZ Unit', key: 'sez_unit_gstin', width: 18 },
    { header: 'Invoice Number', key: 'invoice_number', width: 20 },
    { header: 'Invoice date', key: 'invoice_date', width: 12 },
    { header: 'Invoice Value', key: 'invoice_value', width: 15 },
    { header: 'Place Of Supply', key: 'place_of_supply', width: 15 },
    { header: 'Supply Type', key: 'supply_type', width: 15 },
    { header: 'Rate', key: 'rate', width: 8 },
    { header: 'Taxable Value', key: 'taxable_value', width: 15 },
    { header: 'Integrated Tax', key: 'igst', width: 15 },
    { header: 'Cess Amount', key: 'cess', width: 15 },
  ];
  
  report.sez.forEach((item) => {
    sezSheet.addRow({
      sez_unit_gstin: item.sez_unit_gstin || '',
      invoice_number: item.invoice_number || '',
      invoice_date: formatDateForGSTN(item.invoice_date),
      invoice_value: Math.round(item.invoice_value * 100) / 100,
      place_of_supply: item.place_of_supply || '',
      supply_type: item.sez_type === 'WPAY' ? 'With Payment' : 'Without Payment',
      rate: item.rate,
      taxable_value: Math.round(item.taxable_value * 100) / 100,
      igst: Math.round((item.igst_amount || 0) * 100) / 100,
      cess: Math.round((item.cess_amount || 0) * 100) / 100,
    });
  });
  
  if (sezSheet.rowCount > 0) {
    const headerRow = sezSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  }
  
  // ============================================
  // SHEET 9: HSN (HSN Summary)
  // ============================================
  const hsnSheet = workbook.addWorksheet('HSN');
  hsnSheet.columns = [
    { header: 'HSN', key: 'hsn', width: 12 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'UQC', key: 'uqc', width: 10 },
    { header: 'Total Quantity', key: 'total_quantity', width: 15 },
    { header: 'Total Value', key: 'total_value', width: 15 },
    { header: 'Taxable Value', key: 'taxable_value', width: 15 },
    { header: 'Integrated Tax Amount', key: 'igst', width: 18 },
    { header: 'Central Tax Amount', key: 'cgst', width: 18 },
    { header: 'State/UT Tax Amount', key: 'sgst', width: 18 },
    { header: 'Cess Amount', key: 'cess', width: 15 },
    { header: 'Rate', key: 'rate', width: 8 },
  ];
  
  report.hsn.forEach((item) => {
    hsnSheet.addRow({
      hsn: item.hsn_sac || 'NA',
      description: item.description || '',
      uqc: item.uqc || 'NOS',
      total_quantity: Math.round(item.total_quantity * 100) / 100,
      total_value: Math.round(item.total_value * 100) / 100,
      taxable_value: Math.round(item.taxable_value * 100) / 100,
      igst: Math.round(item.integrated_tax * 100) / 100,
      cgst: Math.round(item.central_tax * 100) / 100,
      sgst: Math.round(item.state_ut_tax * 100) / 100,
      cess: Math.round((item.cess_amount || 0) * 100) / 100,
      rate: item.rate ?? 0,
    });
  });
  
  if (hsnSheet.rowCount > 0) {
    const headerRow = hsnSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  }
  
  // ============================================
  // SHEET 9: NIL (Nil Rated, Exempt, Non-GST)
  // ============================================
  const nilSheet = workbook.addWorksheet('NIL');
  nilSheet.columns = [
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Nil Rated Supplies', key: 'nil_rated', width: 18 },
    { header: 'Exempted Supplies', key: 'exempted', width: 18 },
    { header: 'Non-GST Supplies', key: 'non_gst', width: 18 },
  ];
  
  report.nil.forEach((item) => {
    nilSheet.addRow({
      description: item.description || '',
      nil_rated: Math.round(item.nil_supply * 100) / 100,
      exempted: Math.round(item.exempt_supply * 100) / 100,
      non_gst: Math.round(item.non_gst_supply * 100) / 100,
    });
  });
  
  if (nilSheet.rowCount > 0) {
    const headerRow = nilSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
  }
  
  // ============================================
  // SHEET 10: AT (Amendments - Tax Period)
  // ============================================
  const atSheet = workbook.addWorksheet('AT');
  atSheet.columns = [
    { header: 'Original Month', key: 'original_month', width: 15 },
    { header: 'Original Financial Year', key: 'original_fy', width: 20 },
    { header: 'GSTIN/UIN of Recipient', key: 'gstin', width: 18 },
    { header: 'Invoice Number', key: 'invoice_number', width: 20 },
    { header: 'Invoice date', key: 'invoice_date', width: 12 },
    { header: 'Invoice Value', key: 'invoice_value', width: 15 },
    { header: 'Place Of Supply', key: 'place_of_supply', width: 15 },
    { header: 'Supply Attract Reverse Charge', key: 'reverse_charge', width: 25 },
    { header: 'Invoice Type', key: 'invoice_type', width: 15 },
    { header: 'E-Commerce GSTIN', key: 'ecommerce_gstin', width: 18 },
    { header: 'Rate', key: 'rate', width: 8 },
    { header: 'Taxable Value', key: 'taxable_value', width: 15 },
    { header: 'Integrated Tax', key: 'igst', width: 15 },
    { header: 'Central Tax', key: 'cgst', width: 15 },
    { header: 'State/UT Tax', key: 'sgst', width: 15 },
    { header: 'Cess Amount', key: 'cess', width: 15 },
  ];
  // Empty sheet - header only (required by GSTN)
  const atHeaderRow = atSheet.getRow(1);
  atHeaderRow.font = { bold: true };
  atHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  
  // ============================================
  // SHEET 11: TXP (Tax Period)
  // ============================================
  const txpSheet = workbook.addWorksheet('TXP');
  txpSheet.columns = [
    { header: 'Original Month', key: 'original_month', width: 15 },
    { header: 'Original Financial Year', key: 'original_fy', width: 20 },
    { header: 'GSTIN/UIN of Recipient', key: 'gstin', width: 18 },
    { header: 'Invoice Number', key: 'invoice_number', width: 20 },
    { header: 'Invoice date', key: 'invoice_date', width: 12 },
    { header: 'Invoice Value', key: 'invoice_value', width: 15 },
    { header: 'Place Of Supply', key: 'place_of_supply', width: 15 },
    { header: 'Supply Attract Reverse Charge', key: 'reverse_charge', width: 25 },
    { header: 'Invoice Type', key: 'invoice_type', width: 15 },
    { header: 'E-Commerce GSTIN', key: 'ecommerce_gstin', width: 18 },
    { header: 'Rate', key: 'rate', width: 8 },
    { header: 'Taxable Value', key: 'taxable_value', width: 15 },
    { header: 'Integrated Tax', key: 'igst', width: 15 },
    { header: 'Central Tax', key: 'cgst', width: 15 },
    { header: 'State/UT Tax', key: 'sgst', width: 15 },
    { header: 'Cess Amount', key: 'cess', width: 15 },
  ];
  // Empty sheet - header only (required by GSTN)
  const txpHeaderRow = txpSheet.getRow(1);
  txpHeaderRow.font = { bold: true };
  txpHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  
  // ============================================
  // SHEET 12: Docs (Document Summary)
  // ============================================
  const docsSheet = workbook.addWorksheet('Docs');
  docsSheet.columns = [
    { header: 'Nature Of Document', key: 'nature', width: 20 },
    { header: 'Sr No From', key: 'sr_no_from', width: 12 },
    { header: 'Sr No To', key: 'sr_no_to', width: 12 },
    { header: 'Total Number', key: 'total_number', width: 12 },
    { header: 'Cancelled', key: 'cancelled', width: 12 },
  ];
  // Empty sheet - header only (required by GSTN)
  const docsHeaderRow = docsSheet.getRow(1);
  docsHeaderRow.font = { bold: true };
  docsHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  
  // ============================================
  // SHEET 13: Summary (Summary of all sections)
  // ============================================
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Section', key: 'section', width: 25 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Total Taxable Value', key: 'taxable_value', width: 20 },
    { header: 'Total IGST', key: 'igst', width: 15 },
    { header: 'Total CGST', key: 'cgst', width: 15 },
    { header: 'Total SGST', key: 'sgst', width: 15 },
    { header: 'Total Cess', key: 'cess', width: 15 },
    { header: 'Invoice/Item Count', key: 'count', width: 18 },
  ];
  
  // Calculate summary totals using stored DB values (no recalculation)
  const b2bTotalTaxable = report.b2b.reduce((sum, item) => sum + item.taxable_value, 0);
  const b2bTaxes = report.b2b.reduce((acc, item) => {
    acc.igst += item.igst_amount || 0;
    acc.cgst += item.cgst_amount || 0;
    acc.sgst += item.sgst_amount || 0;
    acc.cess += item.cess_amount || 0;
    return acc;
  }, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  
  const b2clTotalTaxable = report.b2cl.reduce((sum, item) => sum + item.taxable_value, 0);
  const b2clTaxes = report.b2cl.reduce((acc, item) => {
    acc.igst += item.igst_amount || 0;
    acc.cess += item.cess_amount || 0;
    return acc;
  }, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  
  const b2csTotalTaxable = report.b2cs.reduce((sum, item) => sum + item.taxable_value, 0);
  const b2csTaxes = report.b2cs.reduce((acc, item) => {
    acc.igst += item.igst_amount || 0;
    acc.cgst += item.cgst_amount || 0;
    acc.sgst += item.sgst_amount || 0;
    acc.cess += item.cess_amount || 0;
    return acc;
  }, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  
  const expTotalTaxable = report.exports.reduce((sum, item) => sum + item.taxable_value, 0);
  
  const cdnrTotalTaxable = report.cdn.filter(c => c.gstin_uin_recipient).reduce((sum, item) => sum + item.taxable_value, 0);
  const cdnrTaxes = report.cdn.filter(c => c.gstin_uin_recipient).reduce((acc, item) => {
    acc.igst += item.igst_amount || 0;
    acc.cgst += item.cgst_amount || 0;
    acc.sgst += item.sgst_amount || 0;
    acc.cess += item.cess_amount || 0;
    return acc;
  }, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  
  const cdnurTotalTaxable = report.cdn.filter(c => !c.gstin_uin_recipient).reduce((sum, item) => sum + item.taxable_value, 0);
  const cdnurTaxes = report.cdn.filter(c => !c.gstin_uin_recipient).reduce((acc, item) => {
    acc.igst += item.igst_amount || 0;
    acc.cgst += item.cgst_amount || 0;
    acc.sgst += item.sgst_amount || 0;
    acc.cess += item.cess_amount || 0;
    return acc;
  }, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  
  const hsnTotalTaxable = report.hsn.reduce((sum, item) => sum + item.taxable_value, 0);
  const hsnTaxes = report.hsn.reduce((acc, item) => {
    acc.igst += item.integrated_tax;
    acc.cgst += item.central_tax;
    acc.sgst += item.state_ut_tax;
    acc.cess += item.cess_amount || 0;
    return acc;
  }, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  
  const nilTotal = report.nil.reduce((acc, item) => {
    acc.nil += item.nil_supply;
    acc.exempt += item.exempt_supply;
    acc.nongst += item.non_gst_supply;
    return acc;
  }, { nil: 0, exempt: 0, nongst: 0 });
  
  // Add summary rows
  summarySheet.addRow({
    section: 'B2B',
    description: 'B2B Invoices',
    taxable_value: Math.round(b2bTotalTaxable * 100) / 100,
    igst: Math.round(b2bTaxes.igst * 100) / 100,
    cgst: Math.round(b2bTaxes.cgst * 100) / 100,
    sgst: Math.round(b2bTaxes.sgst * 100) / 100,
    cess: Math.round(b2bTaxes.cess * 100) / 100,
    count: report.b2b.length,
  });
  
  summarySheet.addRow({
    section: 'B2CL',
    description: 'B2C Large Invoices (>2.5L, Inter-state)',
    taxable_value: Math.round(b2clTotalTaxable * 100) / 100,
    igst: Math.round(b2clTaxes.igst * 100) / 100,
    cgst: 0,
    sgst: 0,
    cess: Math.round(b2clTaxes.cess * 100) / 100,
    count: report.b2cl.length,
  });
  
  summarySheet.addRow({
    section: 'B2CS',
    description: 'B2C Small Supplies (Aggregated)',
    taxable_value: Math.round(b2csTotalTaxable * 100) / 100,
    igst: Math.round(b2csTaxes.igst * 100) / 100,
    cgst: Math.round(b2csTaxes.cgst * 100) / 100,
    sgst: Math.round(b2csTaxes.sgst * 100) / 100,
    cess: Math.round(b2csTaxes.cess * 100) / 100,
    count: report.b2cs.length,
  });
  
  summarySheet.addRow({
    section: 'EXPORT',
    description: 'Export Invoices',
    taxable_value: Math.round(expTotalTaxable * 100) / 100,
    igst: 0,
    cgst: 0,
    sgst: 0,
    cess: 0,
    count: report.exports.length,
  });
  
  summarySheet.addRow({
    section: 'CDNR',
    description: 'Credit/Debit Notes (B2B)',
    taxable_value: Math.round(cdnrTotalTaxable * 100) / 100,
    igst: Math.round(cdnrTaxes.igst * 100) / 100,
    cgst: Math.round(cdnrTaxes.cgst * 100) / 100,
    sgst: Math.round(cdnrTaxes.sgst * 100) / 100,
    cess: Math.round(cdnrTaxes.cess * 100) / 100,
    count: report.cdn.filter(c => c.gstin_uin_recipient).length,
  });
  
  summarySheet.addRow({
    section: 'CDNUR',
    description: 'Credit/Debit Notes (B2C/Unregistered)',
    taxable_value: Math.round(cdnurTotalTaxable * 100) / 100,
    igst: Math.round(cdnurTaxes.igst * 100) / 100,
    cgst: Math.round(cdnurTaxes.cgst * 100) / 100,
    sgst: Math.round(cdnurTaxes.sgst * 100) / 100,
    cess: Math.round(cdnurTaxes.cess * 100) / 100,
    count: report.cdn.filter(c => !c.gstin_uin_recipient).length,
  });
  
  summarySheet.addRow({
    section: 'HSN',
    description: 'HSN Summary',
    taxable_value: Math.round(hsnTotalTaxable * 100) / 100,
    igst: Math.round(hsnTaxes.igst * 100) / 100,
    cgst: Math.round(hsnTaxes.cgst * 100) / 100,
    sgst: Math.round(hsnTaxes.sgst * 100) / 100,
    cess: Math.round(hsnTaxes.cess * 100) / 100,
    count: report.hsn.length,
  });
  
  summarySheet.addRow({
    section: 'NIL',
    description: 'Nil/Exempt/Non-GST Supplies',
    taxable_value: Math.round((nilTotal.nil + nilTotal.exempt + nilTotal.nongst) * 100) / 100,
    igst: 0,
    cgst: 0,
    sgst: 0,
    cess: 0,
    count: report.nil.length,
  });
  
  // Add totals row
  const grandTotalTaxable = b2bTotalTaxable + b2clTotalTaxable + b2csTotalTaxable + expTotalTaxable + cdnrTotalTaxable + cdnurTotalTaxable + hsnTotalTaxable + nilTotal.nil + nilTotal.exempt + nilTotal.nongst;
  const grandTotalIGST = b2bTaxes.igst + b2clTaxes.igst + b2csTaxes.igst + cdnrTaxes.igst + cdnurTaxes.igst + hsnTaxes.igst;
  const grandTotalCGST = b2bTaxes.cgst + b2csTaxes.cgst + cdnrTaxes.cgst + cdnurTaxes.cgst + hsnTaxes.cgst;
  const grandTotalSGST = b2bTaxes.sgst + b2csTaxes.sgst + cdnrTaxes.sgst + cdnurTaxes.sgst + hsnTaxes.sgst;
  const grandTotalCess = b2bTaxes.cess + b2clTaxes.cess + b2csTaxes.cess + cdnrTaxes.cess + cdnurTaxes.cess + hsnTaxes.cess;
  
  summarySheet.addRow({}); // Empty row for spacing
  
  const totalRow = summarySheet.addRow({
    section: 'GRAND TOTAL',
    description: 'Total of All Sections',
    taxable_value: Math.round(grandTotalTaxable * 100) / 100,
    igst: Math.round(grandTotalIGST * 100) / 100,
    cgst: Math.round(grandTotalCGST * 100) / 100,
    sgst: Math.round(grandTotalSGST * 100) / 100,
    cess: Math.round(grandTotalCess * 100) / 100,
    count: report.b2b.length + report.b2cl.length + report.b2cs.length + report.exports.length + report.cdn.length + report.hsn.length + report.nil.length,
  });
  
  // Style header row
  const summaryHeaderRow = summarySheet.getRow(1);
  summaryHeaderRow.font = { bold: true };
  summaryHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  
  // Style total row
  totalRow.font = { bold: true };
  totalRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFE6CC' }
  };
  
  // ============================================
  // SHEET 14: Master (Master Data - required by GSTN)
  // ============================================
  const masterSheet = workbook.addWorksheet('Master');
  masterSheet.columns = [
    { header: 'Field', key: 'field', width: 30 },
    { header: 'Value', key: 'value', width: 50 },
  ];
  
  // Populate master data
  const financialYear = filters.year ? `${filters.year - 1}-${filters.year.toString().slice(2)}` : '';
  const taxPeriod = filters.month && filters.year 
    ? `${filters.year.toString().slice(2)}${filters.month.toString().padStart(2, '0')}`
    : '';
  
  masterSheet.addRow({ field: 'GSTIN', value: businessGstin });
  masterSheet.addRow({ field: 'Financial Year', value: financialYear });
  masterSheet.addRow({ field: 'Tax Period', value: taxPeriod });
  masterSheet.addRow({ field: 'Return Type', value: 'GSTR1' });
  
  const masterHeaderRow = masterSheet.getRow(1);
  masterHeaderRow.font = { bold: true };
  masterHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  
  // ============================================
  // SHEET 14: Error (Error Sheet - required by GSTN)
  // ============================================
  const errorSheet = workbook.addWorksheet('Error');
  errorSheet.columns = [
    { header: 'Sheet Name', key: 'sheet_name', width: 15 },
    { header: 'Row Number', key: 'row_number', width: 12 },
    { header: 'Column Name', key: 'column_name', width: 20 },
    { header: 'Error Message', key: 'error_message', width: 50 },
  ];
  // Empty sheet - header only (required by GSTN)
  const errorHeaderRow = errorSheet.getRow(1);
  errorHeaderRow.font = { bold: true };
  errorHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  
  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

