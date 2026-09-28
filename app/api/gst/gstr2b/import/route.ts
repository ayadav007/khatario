export const dynamic = 'force-dynamic';

/**
 * GSTR-2B Import API
 *
 * Imports the GSTR-2B JSON downloaded from the GST portal (or the older offline-tool layout)
 * into read-only tables for reconciliation. One row per document.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import crypto from 'crypto';
import { assertGstr2bApiAccess } from '@/lib/gst/gstr2b-route-guard';
import { parseGstr2bJson, totalEligibleItc } from '@/lib/gst/gstr2b-portal-parser';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const business_id = formData.get('business_id') as string;
  const filing_period = formData.get('filing_period') as string; // YYYY-MM
  const file = formData.get('file') as File;

  if (!business_id || !filing_period || !file) {
    return NextResponse.json({ success: false, error: 'business_id, filing_period, and file are required' }, { status: 400 });
  }
  const access = await assertGstr2bApiAccess(request, business_id, 'create');
  if (!access.ok) return access.response;

  if (!/^\d{4}-\d{2}$/.test(filing_period)) {
    return NextResponse.json({ success: false, error: 'filing_period must be in YYYY-MM format' }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith('.json')) {
    return NextResponse.json(
      { success: false, error: 'Upload the GSTR-2B JSON downloaded from the GST portal (Excel is not supported yet).' },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed: ReturnType<typeof parseGstr2bJson>;
  try {
    parsed = parseGstr2bJson(JSON.parse(buffer.toString('utf-8')));
  } catch {
    return NextResponse.json({ success: false, error: 'The file is not valid JSON' }, { status: 400 });
  }

  if (parsed.returnPeriod && parsed.returnPeriod !== filing_period) {
    return NextResponse.json(
      {
        success: false,
        error: `This GSTR-2B is for ${parsed.returnPeriod}, not ${filing_period}`,
        code: 'PERIOD_MISMATCH',
      },
      { status: 400 }
    );
  }
  if (parsed.rows.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'No documents found in the file. Expected the portal GSTR-2B JSON (data.docdata.b2b / cdnr / impg).',
        code: 'NO_DOCUMENTS',
        invoices_imported: 0,
      },
      { status: 422 }
    );
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    const biz = await client.query(`SELECT gstin FROM businesses WHERE id = $1`, [access.businessId]);
    const ownGstin = String(biz.rows[0]?.gstin || '').toUpperCase();
    if (parsed.recipientGstin && ownGstin && parsed.recipientGstin !== ownGstin) {
      const branch = await client.query(
        `SELECT 1 FROM branches WHERE business_id = $1 AND UPPER(gstin) = $2 LIMIT 1`,
        [access.businessId, parsed.recipientGstin]
      );
      if (branch.rows.length === 0) {
        return NextResponse.json(
          { success: false, error: `This GSTR-2B belongs to GSTIN ${parsed.recipientGstin}`, code: 'GSTIN_MISMATCH' },
          { status: 400 }
        );
      }
    }

    await client.query('BEGIN');
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const duplicateCheck = await client.query(
      'SELECT id FROM gstr2b_imports WHERE business_id = $1 AND filing_period = $2 AND file_hash = $3',
      [access.businessId, filing_period, fileHash]
    );
    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'This file has already been imported for this period' },
        { status: 409 }
      );
    }

    const totalItc = totalEligibleItc(parsed.rows);
    const importResult = await client.query(
      `INSERT INTO gstr2b_imports (
         business_id, filing_period, import_type, file_name, file_hash, total_invoices, total_itc, imported_by
       ) VALUES ($1, $2, 'json', $3, $4, $5, $6, $7)
       RETURNING id`,
      [access.businessId, filing_period, file.name, fileHash, parsed.rows.length, totalItc, access.userId]
    );
    const importId = importResult.rows[0].id;

    let inserted = 0;
    for (const r of parsed.rows) {
      const res = await client.query(
        `INSERT INTO gstr2b_invoices (
           import_id, business_id, filing_period,
           supplier_gstin, supplier_name, invoice_number, invoice_date, document_type,
           taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount,
           itc_eligibility, itc_reversal_type, place_of_supply, reverse_charge,
           original_invoice_number, original_invoice_date
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (import_id, supplier_gstin, invoice_number, invoice_date, document_type) DO NOTHING`,
        [
          importId,
          access.businessId,
          filing_period,
          r.supplier_gstin,
          r.supplier_name,
          r.invoice_number,
          r.invoice_date,
          r.document_type,
          r.taxable_value,
          r.igst_amount,
          r.cgst_amount,
          r.sgst_amount,
          r.cess_amount,
          r.itc_eligibility,
          r.itc_reversal_type,
          r.place_of_supply,
          r.reverse_charge,
          r.original_invoice_number,
          r.original_invoice_date,
        ]
      );
      inserted += res.rowCount || 0;
    }
    await client.query('UPDATE gstr2b_imports SET total_invoices = $1 WHERE id = $2', [inserted, importId]);
    await client.query('COMMIT');

    return NextResponse.json({
      success: inserted > 0,
      import_id: importId,
      invoices_imported: inserted,
      duplicates_skipped: parsed.rows.length - inserted,
      total_itc: totalItc,
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('GSTR-2B Import Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to import GSTR-2B data', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
