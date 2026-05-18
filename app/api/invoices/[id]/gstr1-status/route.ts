import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getBusinessIdFromRequest } from '@/lib/auth-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: invoiceId } = params;

    const businessScope = getBusinessIdFromRequest(request);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const pool = getPool();
    const client = await pool.connect();
    
    try {
      // Check if invoice is in a filed GSTR-1
      const result = await client.query(
        `SELECT 
          f.id as filing_id,
          f.filing_period,
          f.status as filing_status,
          f.filing_date,
          f.lock_date
         FROM gstr1_filings f
         JOIN gstr1_filing_invoices fi ON f.id = fi.gstr1_filing_id
         JOIN invoices inv ON inv.id = fi.invoice_id AND inv.deleted_at IS NULL
         WHERE fi.invoice_id = $1 AND inv.business_id = $2
         ORDER BY f.created_at DESC
         LIMIT 1`,
        [invoiceId, businessScope]
      );

      if (result.rows.length === 0) {
        // Check if invoice is final and not a proforma invoice (should be in GSTR-1 but not yet)
        const invoiceRes = await client.query(
          `SELECT status, document_type FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
          [invoiceId, businessScope]
        );

        if (invoiceRes.rows.length === 0) {
          return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
        }

        const invoice = invoiceRes.rows[0];
        
        // Proforma invoices are not applicable for GSTR-1
        if (invoice.document_type === 'proforma_invoice') {
          return NextResponse.json({
            status: 'not_applicable',
            message: 'Proforma invoices are not included in GSTR-1'
          });
        }
        
        if (invoice.status === 'final') {
          return NextResponse.json({
            status: 'pending',
            message: 'Pending in GSTR-1'
          });
        } else {
          return NextResponse.json({
            status: 'not_applicable',
            message: 'Not in GSTR-1'
          });
        }
      }

      const filing = result.rows[0];
      
      if (filing.filing_status === 'filed') {
        return NextResponse.json({
          status: 'included',
          message: `Included in GSTR-1 (${filing.filing_period})`,
          filing_period: filing.filing_period,
          filing_date: filing.filing_date,
          lock_date: filing.lock_date
        });
      } else {
        return NextResponse.json({
          status: 'pending',
          message: 'Pending in GSTR-1',
          filing_period: filing.filing_period
        });
      }

    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error fetching GSTR-1 status:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

