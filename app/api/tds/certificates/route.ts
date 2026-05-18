import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, getPool } from '@/lib/db';
import { TDSCertificate } from '@/types/database';

/**
 * GET /api/tds/certificates
 * List TDS certificates
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const supplierId = searchParams.get('supplier_id');
    const financialYear = searchParams.get('financial_year');
    const quarter = searchParams.get('quarter');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        c.*,
        s.name as supplier_name,
        s.gstin as supplier_gstin
      FROM tds_certificates c
      LEFT JOIN suppliers s ON c.supplier_id = s.id
      WHERE c.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (supplierId) {
      sql += ` AND c.supplier_id = $${paramIndex}`;
      params.push(supplierId);
      paramIndex++;
    }

    if (financialYear) {
      sql += ` AND c.financial_year = $${paramIndex}`;
      params.push(financialYear);
      paramIndex++;
    }

    if (quarter) {
      sql += ` AND c.quarter = $${paramIndex}`;
      params.push(quarter);
      paramIndex++;
    }

    sql += ` ORDER BY c.issue_date DESC, c.created_at DESC`;

    const certificates = await queryRows(sql, params);

    return NextResponse.json({ certificates });
  } catch (error: any) {
    console.error('Error fetching TDS certificates:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tds/certificates
 * Generate TDS certificate (Form 16A)
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      business_id,
      supplier_id,
      financial_year,
      quarter,
      issue_date,
      created_by,
    } = body;

    if (!business_id || !supplier_id || !financial_year || !quarter || !issue_date) {
      return NextResponse.json(
        { error: 'business_id, supplier_id, financial_year, quarter, and issue_date are required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Check if certificate already exists
    const existing = await queryOne(
      'SELECT id FROM tds_certificates WHERE business_id = $1 AND supplier_id = $2 AND financial_year = $3 AND quarter = $4',
      [business_id, supplier_id, financial_year, quarter]
    );

    if (existing) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Certificate already exists for this supplier, financial year, and quarter' },
        { status: 409 }
      );
    }

    // Get total TDS amount for this supplier, FY, and quarter
    const tdsTotal = await queryOne(`
      SELECT 
        COALESCE(SUM(tds_amount), 0) as total
      FROM tds_transactions
      WHERE business_id = $1 
        AND supplier_id = $2
        AND financial_year = $3
        AND quarter = $4
        AND is_deposited = true
    `, [business_id, supplier_id, financial_year, quarter]);

    if (parseFloat(tdsTotal?.total || '0') === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'No TDS transactions found for this supplier in the specified period' },
        { status: 400 }
      );
    }

    // Generate certificate number
    const certNumber = `TDS/${financial_year}/${quarter}/${supplier_id.substring(0, 8).toUpperCase()}`;

    const certificate = await client.query<TDSCertificate>(
      `INSERT INTO tds_certificates (
        business_id, supplier_id, financial_year, quarter,
        certificate_number, issue_date, total_tds_amount,
        is_issued, issued_date, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        business_id,
        supplier_id,
        financial_year,
        quarter,
        certNumber,
        issue_date,
        tdsTotal.total,
        true,
        issue_date,
        created_by || null,
      ]
    );

    // TODO: Generate PDF certificate using template
    // For now, we'll just store the certificate record
    // PDF generation can be added later using the payslip generator pattern

    await client.query('COMMIT');

    return NextResponse.json({
      certificate: certificate.rows[0],
      message: 'TDS certificate generated successfully',
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error generating TDS certificate:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

