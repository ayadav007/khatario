/**
 * Shared GSTR-2B import. JSON and Excel both become Gstr2bRow records, then one
 * transaction writes the statement. A failed insert rolls the whole statement back.
 */
import crypto from 'crypto';
import { getPool } from '@/lib/db';
import { resolveSupplierRegistration } from '@/lib/gst/registration';
import { markGstReadinessStale } from '@/lib/gst/period-freshness';
import { parseGstr2bJson, totalEligibleItc, type Gstr2bRow } from '@/lib/gst/gstr2b-portal-parser';
import { parseGstr2bExcel, type Gstr2bRowError, type Gstr2bSheetReport } from '@/lib/gst/gstr2b-excel-parser';

export const GSTR2B_MAX_BYTES = 8 * 1024 * 1024;

export class Gstr2bImportError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: { errors?: Gstr2bRowError[]; sections?: Gstr2bSheetReport[] }
  ) {
    super(message);
  }
}

export interface Gstr2bImportSuccess {
  success: true;
  import_id: string;
  source: 'json' | 'excel';
  filing_period: string;
  invoices_imported: number;
  duplicates_skipped: number;
  total_itc: number;
  sections: Gstr2bSheetReport[];
}

function sectionsFromRows(rows: Gstr2bRow[]): Gstr2bSheetReport[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.original_invoice_number && row.document_type === 'invoice'
      ? 'B2BA'
      : row.original_invoice_number && (row.document_type === 'credit_note' || row.document_type === 'debit_note')
        ? 'CDNRA'
        : row.document_type;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].map(([sheet, documents]) => ({ sheet, status: 'imported' as const, documents }));
}

/**
 * The GSTIN this 2B belongs to: the one in the file (must be the business's or one of its
 * branches'), else the registration of the branch it was uploaded for.
 */
async function resolveRecipient(businessId: string, fileGstin: string | null, branchId?: string | null): Promise<string | null> {
  const pool = getPool();
  if (fileGstin) {
    const gstin = fileGstin.trim().toUpperCase();
    const known = await pool.query(
      `SELECT 1 FROM businesses WHERE id = $1 AND UPPER(TRIM(gstin)) = $2
       UNION ALL
       SELECT 1 FROM branches WHERE business_id = $1 AND UPPER(TRIM(gstin)) = $2
       LIMIT 1`,
      [businessId, gstin]
    );
    if (known.rows.length === 0) {
      throw new Gstr2bImportError(`This GSTR-2B belongs to GSTIN ${gstin}`, 400, 'GSTIN_MISMATCH');
    }
    return gstin;
  }
  const reg = await resolveSupplierRegistration(pool, businessId, branchId ?? null);
  return reg.gstin ? reg.gstin.toUpperCase() : null;
}

export async function persistGstr2bRows(input: {
  businessId: string;
  userId: string | null;
  filingPeriod: string;
  fileName: string;
  fileHash: string;
  importType: 'json' | 'excel';
  rows: Gstr2bRow[];
  duplicatesSkipped?: number;
  recipientGstin?: string | null;
}): Promise<{ importId: string; inserted: number; duplicatesSkipped: number; totalItc: number }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const duplicate = await client.query(
      'SELECT id FROM gstr2b_imports WHERE business_id = $1 AND filing_period = $2 AND file_hash = $3',
      [input.businessId, input.filingPeriod, input.fileHash]
    );
    if (duplicate.rows.length > 0) {
      await client.query('ROLLBACK');
      throw new Gstr2bImportError('This file has already been imported for this period', 409, 'DUPLICATE_IMPORT');
    }
    const totalItc = totalEligibleItc(input.rows);
    const created = await client.query(
      `INSERT INTO gstr2b_imports (
         business_id, filing_period, import_type, file_name, file_hash, total_invoices, total_itc, imported_by, recipient_gstin
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        input.businessId, input.filingPeriod, input.importType, input.fileName, input.fileHash, input.rows.length,
        totalItc, input.userId, input.recipientGstin ?? null,
      ]
    );
    const importId = created.rows[0].id;
    let inserted = 0;
    for (const row of input.rows) {
      const res = await client.query(
        `INSERT INTO gstr2b_invoices (
           import_id, business_id, filing_period,
           supplier_gstin, supplier_name, invoice_number, invoice_date, document_type,
           taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount,
           itc_eligibility, itc_reversal_type, place_of_supply, reverse_charge,
           original_invoice_number, original_invoice_date, recipient_gstin
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (import_id, supplier_gstin, invoice_number, invoice_date, document_type) DO NOTHING`,
        [
          importId, input.businessId, input.filingPeriod,
          row.supplier_gstin, row.supplier_name, row.invoice_number, row.invoice_date, row.document_type,
          row.taxable_value, row.igst_amount, row.cgst_amount, row.sgst_amount, row.cess_amount,
          row.itc_eligibility, row.itc_reversal_type, row.place_of_supply, row.reverse_charge,
          row.original_invoice_number, row.original_invoice_date, input.recipientGstin ?? null,
        ]
      );
      inserted += res.rowCount || 0;
    }
    await client.query('UPDATE gstr2b_imports SET total_invoices = $1 WHERE id = $2', [inserted, importId]);
    await markGstReadinessStale(client, input.businessId, {
      dates: [`${input.filingPeriod}-01`],
      monthly: ['gstr2b', 'gstr3b'],
    });
    await client.query('COMMIT');
    return {
      importId,
      inserted,
      duplicatesSkipped: (input.duplicatesSkipped || 0) + (input.rows.length - inserted),
      totalItc,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function importGstr2bFile(input: {
  businessId: string;
  userId: string | null;
  filingPeriod: string;
  fileName: string;
  bytes: Buffer;
  /** Branch the 2B was uploaded for; its GSTIN is used when the file does not name one. */
  branchId?: string | null;
}): Promise<Gstr2bImportSuccess> {
  if (!/^\d{4}-\d{2}$/.test(input.filingPeriod)) {
    throw new Gstr2bImportError('filing_period must be in YYYY-MM format', 400, 'BAD_PERIOD');
  }
  if (input.bytes.length > GSTR2B_MAX_BYTES) {
    throw new Gstr2bImportError('File is larger than 8 MB', 400, 'FILE_TOO_LARGE');
  }
  const name = input.fileName.toLowerCase();
  const isExcel = name.endsWith('.xlsx');
  const isJson = name.endsWith('.json');
  if (!isExcel && !isJson) {
    throw new Gstr2bImportError('Upload a GSTR-2B JSON or Excel file downloaded from the GST portal.', 400, 'BAD_FILE_TYPE');
  }

  let rows: Gstr2bRow[];
  let returnPeriod: string | null;
  let recipientGstin: string | null;
  let sections: Gstr2bSheetReport[];
  let duplicatesSkipped = 0;

  if (isJson) {
    let json: unknown;
    try {
      json = JSON.parse(input.bytes.toString('utf-8'));
    } catch {
      throw new Gstr2bImportError('The file is not valid JSON', 400, 'BAD_JSON');
    }
    const parsed = parseGstr2bJson(json);
    rows = parsed.rows;
    returnPeriod = parsed.returnPeriod;
    recipientGstin = parsed.recipientGstin;
    sections = sectionsFromRows(rows);
  } else {
    const parsed = await parseGstr2bExcel(input.bytes);
    if (!parsed.ok) {
      const wrong = parsed.errors.some((error) => /GSTR-1/.test(error.message));
      throw new Gstr2bImportError(
        parsed.errors[0]?.message || 'This workbook cannot be imported.',
        422,
        wrong ? 'WRONG_WORKBOOK' : parsed.errors.some((error) => /Missing columns/.test(error.message)) ? 'MISSING_COLUMNS' : 'EXCEL_INVALID',
        { errors: parsed.errors, sections: parsed.sections }
      );
    }
    rows = parsed.rows;
    returnPeriod = parsed.returnPeriod;
    recipientGstin = parsed.recipientGstin;
    sections = parsed.sections;
    duplicatesSkipped = parsed.duplicatesSkipped;
  }

  if (returnPeriod && returnPeriod !== input.filingPeriod) {
    throw new Gstr2bImportError(`This GSTR-2B is for ${returnPeriod}, not ${input.filingPeriod}`, 400, 'PERIOD_MISMATCH');
  }
  if (rows.length === 0) {
    throw new Gstr2bImportError(
      'No documents found in the file. Expected the portal GSTR-2B JSON (data.docdata.b2b / cdnr / impg) or an Excel workbook with B2B, CDNR, ISD or IMPG sheets.',
      422,
      'NO_DOCUMENTS',
      { sections }
    );
  }
  const recipient = await resolveRecipient(input.businessId, recipientGstin, input.branchId);

  const fileHash = crypto.createHash('sha256').update(input.bytes).digest('hex');
  const saved = await persistGstr2bRows({
    businessId: input.businessId,
    userId: input.userId,
    filingPeriod: input.filingPeriod,
    fileName: input.fileName,
    fileHash,
    importType: isExcel ? 'excel' : 'json',
    rows,
    duplicatesSkipped,
    recipientGstin: recipient,
  });
  return {
    success: true,
    import_id: saved.importId,
    source: isExcel ? 'excel' : 'json',
    filing_period: input.filingPeriod,
    invoices_imported: saved.inserted,
    duplicates_skipped: saved.duplicatesSkipped,
    total_itc: saved.totalItc,
    sections,
  };
}
