/**
 * GSTR-2B Import API
 * 
 * Imports GSTR-2B data from GST portal (JSON/Excel format)
 * Stores data in read-only tables for reconciliation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import crypto from 'crypto';

interface GSTR2BInvoiceData {
  supplier_gstin: string;
  supplier_name?: string;
  invoice_number: string;
  invoice_date: string; // DD-MM-YYYY or YYYY-MM-DD
  document_type: 'invoice' | 'credit_note' | 'debit_note';
  taxable_value: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  cess_amount: number;
  itc_eligibility: 'eligible' | 'ineligible' | 'blocked';
  itc_reversal_type?: string;
  place_of_supply?: string;
  reverse_charge?: 'Y' | 'N';
  original_invoice_number?: string;
  original_invoice_date?: string;
}

export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    const formData = await request.formData();
    const business_id = formData.get('business_id') as string;
    const filing_period = formData.get('filing_period') as string; // YYYY-MM format
    const file = formData.get('file') as File;
    const user_id = formData.get('user_id') as string; // Current user ID
    
    if (!business_id || !filing_period || !file) {
      return NextResponse.json(
        { error: 'business_id, filing_period, and file are required' },
        { status: 400 }
      );
    }
    
    // Validate filing_period format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(filing_period)) {
      return NextResponse.json(
        { error: 'filing_period must be in YYYY-MM format' },
        { status: 400 }
      );
    }
    
    await client.query('BEGIN');
    
    // Read file content
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
    
    // Check for duplicate import
    const duplicateCheck = await client.query(
      'SELECT id FROM gstr2b_imports WHERE business_id = $1 AND filing_period = $2 AND file_hash = $3',
      [business_id, filing_period, fileHash]
    );
    
    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'This file has already been imported for this period' },
        { status: 409 }
      );
    }
    
    // Parse JSON file (GST portal exports GSTR-2B as JSON)
    let invoices: GSTR2BInvoiceData[] = [];
    const fileType = file.name.endsWith('.json') ? 'json' : 'excel';
    
    if (fileType === 'json') {
      const jsonContent = JSON.parse(buffer.toString('utf-8'));
      invoices = parseGSTR2BJSON(jsonContent);
    } else {
      // Excel parsing would require exceljs library
      return NextResponse.json(
        { error: 'Excel import not yet implemented. Please use JSON format.' },
        { status: 400 }
      );
    }
    
    // Create import record
    const importResult = await client.query(`
      INSERT INTO gstr2b_imports (
        business_id, filing_period, import_type, file_name, file_hash,
        total_invoices, total_itc, imported_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      business_id,
      filing_period,
      fileType,
      file.name,
      fileHash,
      invoices.length,
      0, // Will calculate total ITC
      user_id || null
    ]);
    
    const importId = importResult.rows[0].id;
    let totalITC = 0;
    
    // Insert invoice records
    for (const invoice of invoices) {
      // Parse date (handle DD-MM-YYYY or YYYY-MM-DD)
      let invoiceDate: string;
      if (invoice.invoice_date.includes('-')) {
        const parts = invoice.invoice_date.split('-');
        if (parts[0].length === 4) {
          // YYYY-MM-DD
          invoiceDate = invoice.invoice_date;
        } else {
          // DD-MM-YYYY -> YYYY-MM-DD
          invoiceDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
      } else {
        invoiceDate = invoice.invoice_date;
      }
      
      await client.query(`
        INSERT INTO gstr2b_invoices (
          import_id, business_id, filing_period,
          supplier_gstin, supplier_name, invoice_number, invoice_date, document_type,
          taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount,
          itc_eligibility, itc_reversal_type, place_of_supply, reverse_charge,
          original_invoice_number, original_invoice_date
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (import_id, supplier_gstin, invoice_number, invoice_date, document_type)
        DO NOTHING
      `, [
        importId,
        business_id,
        filing_period,
        invoice.supplier_gstin,
        invoice.supplier_name || null,
        invoice.invoice_number,
        invoiceDate,
        invoice.document_type,
        invoice.taxable_value,
        invoice.igst_amount,
        invoice.cgst_amount,
        invoice.sgst_amount,
        invoice.cess_amount,
        invoice.itc_eligibility,
        invoice.itc_reversal_type || null,
        invoice.place_of_supply || null,
        invoice.reverse_charge || 'N',
        invoice.original_invoice_number || null,
        invoice.original_invoice_date || null
      ]);
      
      if (invoice.itc_eligibility === 'eligible') {
        totalITC += invoice.igst_amount + invoice.cgst_amount + invoice.sgst_amount + invoice.cess_amount;
      }
    }
    
    // Update total ITC in import record
    await client.query(
      'UPDATE gstr2b_imports SET total_itc = $1 WHERE id = $2',
      [totalITC, importId]
    );
    
    await client.query('COMMIT');
    
    return NextResponse.json({
      success: true,
      import_id: importId,
      invoices_imported: invoices.length,
      total_itc: totalITC
    });
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('GSTR-2B Import Error:', error);
    return NextResponse.json(
      { error: 'Failed to import GSTR-2B data', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

/**
 * Parse GSTR-2B JSON structure from GST portal
 * The actual structure may vary - this is a template
 */
function parseGSTR2BJSON(jsonData: any): GSTR2BInvoiceData[] {
  const invoices: GSTR2BInvoiceData[] = [];
  
  // GST portal GSTR-2B JSON structure typically has:
  // - b2b: B2B invoices
  // - b2ba: B2B amendments
  // - cdn: Credit/Debit notes
  // - cdnr: Credit/Debit note amendments
  
  // Handle B2B invoices
  if (jsonData.b2b && Array.isArray(jsonData.b2b)) {
    jsonData.b2b.forEach((supplier: any) => {
      if (supplier.inv && Array.isArray(supplier.inv)) {
        supplier.inv.forEach((inv: any) => {
          if (inv.itms && Array.isArray(inv.itms)) {
            inv.itms.forEach((item: any) => {
              invoices.push({
                supplier_gstin: supplier.ctin || supplier.gstin || '',
                supplier_name: supplier.name || null,
                invoice_number: inv.inum || inv.inv_num || '',
                invoice_date: inv.idt || inv.inv_dt || '',
                document_type: 'invoice',
                taxable_value: parseFloat(item.itm_det?.txval || 0),
                igst_amount: parseFloat(item.itm_det?.iamt || 0),
                cgst_amount: parseFloat(item.itm_det?.camt || 0),
                sgst_amount: parseFloat(item.itm_det?.samt || 0),
                cess_amount: parseFloat(item.itm_det?.csamt || 0),
                itc_eligibility: item.itm_det?.elig === 'N' ? 'ineligible' : 'eligible',
                itc_reversal_type: item.itm_det?.tx_i || null,
                place_of_supply: inv.pos || null,
                reverse_charge: inv.rchrg === 'Y' ? 'Y' : 'N'
              });
            });
          }
        });
      }
    });
  }
  
  // Handle Credit/Debit Notes (CDN)
  if (jsonData.cdn && Array.isArray(jsonData.cdn)) {
    jsonData.cdn.forEach((supplier: any) => {
      if (supplier.nt && Array.isArray(supplier.nt)) {
        supplier.nt.forEach((note: any) => {
          if (note.itms && Array.isArray(note.itms)) {
            note.itms.forEach((item: any) => {
              invoices.push({
                supplier_gstin: supplier.ctin || supplier.gstin || '',
                supplier_name: supplier.name || null,
                invoice_number: note.nt_num || '',
                invoice_date: note.nt_dt || '',
                document_type: note.ntty === 'C' ? 'credit_note' : 'debit_note',
                taxable_value: parseFloat(item.itm_det?.txval || 0),
                igst_amount: parseFloat(item.itm_det?.iamt || 0),
                cgst_amount: parseFloat(item.itm_det?.camt || 0),
                sgst_amount: parseFloat(item.itm_det?.samt || 0),
                cess_amount: parseFloat(item.itm_det?.csamt || 0),
                itc_eligibility: item.itm_det?.elig === 'N' ? 'ineligible' : 'eligible',
                original_invoice_number: note.nt_num || null,
                original_invoice_date: note.nt_dt || null
              });
            });
          }
        });
      }
    });
  }
  
  // TODO: Handle other sections (b2ba, cdnr, imports, etc.)
  
  return invoices;
}

