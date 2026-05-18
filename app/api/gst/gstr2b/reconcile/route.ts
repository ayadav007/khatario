/**
 * GSTR-2B Reconciliation API
 * 
 * Endpoints for running reconciliation and managing user decisions
 */

import { NextRequest, NextResponse } from 'next/server';
import { GSTR2BReconciliationEngine } from '@/lib/gst/gstr2b-reconciliation';

const reconciliationEngine = new GSTR2BReconciliationEngine();

/**
 * POST /api/gst/gstr2b/reconcile
 * Run reconciliation for a filing period
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, filing_period } = body;
    
    if (!business_id || !filing_period) {
      return NextResponse.json(
        { error: 'business_id and filing_period are required' },
        { status: 400 }
      );
    }
    
    // Validate filing_period format
    if (!/^\d{4}-\d{2}$/.test(filing_period)) {
      return NextResponse.json(
        { error: 'filing_period must be in YYYY-MM format' },
        { status: 400 }
      );
    }
    
    const matches = await reconciliationEngine.reconcile(business_id, filing_period);
    
    return NextResponse.json({
      success: true,
      filing_period,
      total_invoices: matches.length,
      matches: matches.map(m => ({
        ...m,
        invoice_date: typeof m.invoice_date === 'string' ? m.invoice_date : m.invoice_date.toISOString().split('T')[0]
      }))
    });
    
  } catch (error: any) {
    console.error('Reconciliation Error:', error);
    return NextResponse.json(
      { error: 'Failed to run reconciliation', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/gst/gstr2b/reconcile
 * Get reconciliation results for a filing period
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get('business_id');
    const filing_period = searchParams.get('filing_period');
    const match_status = searchParams.get('match_status'); // Optional filter
    
    if (!business_id || !filing_period) {
      return NextResponse.json(
        { error: 'business_id and filing_period are required' },
        { status: 400 }
      );
    }
    
    const { getPool } = await import('@/lib/db');
    const pool = getPool();
    const client = await pool.connect();
    
    try {
      let query = `
        SELECT 
          r.*,
          rd.decision,
          rd.remarks,
          rd.decision_date,
          rd.eligible_itc_amount,
          rd.deferred_to_period,
          u.name as decided_by_name
        FROM gstr2b_reconciliation r
        LEFT JOIN reconciliation_decisions rd ON r.id = rd.reconciliation_id
        LEFT JOIN users u ON rd.decided_by_user_id = u.id
        WHERE r.business_id = $1 AND r.filing_period = $2
      `;
      
      const params: any[] = [business_id, filing_period];
      
      if (match_status) {
        query += ' AND r.match_status = $3';
        params.push(match_status);
      }
      
      query += ' ORDER BY r.supplier_gstin, r.invoice_number, r.invoice_date';
      
      const result = await client.query(query, params);
      
      // Get summary counts
      const summaryResult = await client.query(`
        SELECT 
          match_status,
          COUNT(*) as count,
          COALESCE(SUM(books_itc_amount), 0) as total_books_itc,
          COALESCE(SUM(gstr2b_igst + gstr2b_cgst + gstr2b_sgst + gstr2b_cess), 0) as total_gstr2b_itc
        FROM gstr2b_reconciliation
        WHERE business_id = $1 AND filing_period = $2
        GROUP BY match_status
      `, [business_id, filing_period]);
      
      const summary = summaryResult.rows.reduce((acc: any, row: any) => {
        acc[row.match_status] = {
          count: parseInt(row.count),
          total_books_itc: parseFloat(row.total_books_itc),
          total_gstr2b_itc: parseFloat(row.total_gstr2b_itc)
        };
        return acc;
      }, {});
      
      return NextResponse.json({
        filing_period,
        summary,
        invoices: result.rows.map((row: any) => ({
          id: row.id,
          match_status: row.match_status,
          supplier_gstin: row.supplier_gstin,
          invoice_number: row.invoice_number,
          invoice_date: row.invoice_date,
          document_type: row.document_type,
          books: {
            taxable_value: parseFloat(row.books_taxable_value),
            igst: parseFloat(row.books_igst),
            cgst: parseFloat(row.books_cgst),
            sgst: parseFloat(row.books_sgst),
            cess: parseFloat(row.books_cess),
            itc_amount: parseFloat(row.books_itc_amount)
          },
          gstr2b: {
            taxable_value: parseFloat(row.gstr2b_taxable_value),
            igst: parseFloat(row.gstr2b_igst),
            cgst: parseFloat(row.gstr2b_cgst),
            sgst: parseFloat(row.gstr2b_sgst),
            cess: parseFloat(row.gstr2b_cess),
            itc_eligibility: row.gstr2b_itc_eligibility
          },
          differences: {
            taxable_value: parseFloat(row.difference_taxable_value),
            igst: parseFloat(row.difference_igst),
            cgst: parseFloat(row.difference_cgst),
            sgst: parseFloat(row.difference_sgst),
            cess: parseFloat(row.difference_cess)
          },
          is_import_goods: row.is_import_goods,
          is_import_services: row.is_import_services,
          is_credit_note: row.is_credit_note,
          decision: row.decision,
          remarks: row.remarks,
          decision_date: row.decision_date,
          eligible_itc_amount: row.eligible_itc_amount ? parseFloat(row.eligible_itc_amount) : null,
          deferred_to_period: row.deferred_to_period,
          decided_by_name: row.decided_by_name
        }))
      });
      
    } finally {
      client.release();
    }
    
  } catch (error: any) {
    console.error('Error fetching reconciliation:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reconciliation data', details: error.message },
      { status: 500 }
    );
  }
}

