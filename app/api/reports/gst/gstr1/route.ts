import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { GSTR1Generator, GSTR1Filters } from '@/lib/gst/gstr1';
import { generateGSTR1JSON } from '@/lib/export/json';
import { getPool } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const exportFormat = searchParams.get('export'); // 'json' only (Excel uses separate endpoint)
    const branchIdParam = searchParams.get('branch_id'); // Optional: Filter by branch
    
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription report access
    try {
      await assertReportAccess(business_id, 'gst');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
        businessId: business_id,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // Determine action based on export format
    const action = exportFormat === 'json' ? 'export' : 'read';

    // AUTHORIZATION: Check read/export permission for GST report (PBAC will check branch access, business ownership)
    // Note: Branch filtering happens AFTER authorization - PBAC enforces scope
    try {
      await authorize(userId, 'report.gst', action, {
        businessId: business_id,
        branchId: finalBranchId,
        resource: {
          business_id,
          branch_id: finalBranchId,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const filters: GSTR1Filters = {
      business_id,
      branch_id: finalBranchId,
      month: searchParams.get('month') ? parseInt(searchParams.get('month')!) : undefined,
      year: searchParams.get('year') ? parseInt(searchParams.get('year')!) : undefined,
      from_date: searchParams.get('from_date') || undefined,
      to_date: searchParams.get('to_date') || undefined,
      customer_type: searchParams.get('customer_type') as any
    };

    const generator = new GSTR1Generator();
    const data = await generator.generate(filters);

    // Create or update GSTR-1 filing record
    const pool = getPool();
    const client = await pool.connect();
    try {
      // Determine filing period
      let filingPeriod: string;
      let filingDate: string;
      
      if (filters.month && filters.year) {
        filingPeriod = `${filters.year}-${filters.month.toString().padStart(2, '0')}`;
        filingDate = `${filters.year}-${filters.month.toString().padStart(2, '0')}-01`;
      } else if (filters.from_date && filters.to_date) {
        // Use from_date to determine period
        const fromDate = new Date(filters.from_date);
        filingPeriod = `${fromDate.getFullYear()}-${(fromDate.getMonth() + 1).toString().padStart(2, '0')}`;
        filingDate = filters.from_date;
      } else {
        // Default to current month
        const now = new Date();
        filingPeriod = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
        filingDate = now.toISOString().split('T')[0];
      }

      // Check if filing record already exists
      const existingFiling = await client.query(
        `SELECT id, status FROM gstr1_filings 
         WHERE business_id = $1 AND filing_period = $2`,
        [business_id, filingPeriod]
      );

      let filingId: string;
      
      if (existingFiling.rows.length > 0) {
        // Use existing filing
        filingId = existingFiling.rows[0].id;
      } else {
        // Create new filing record
        const newFiling = await client.query(
          `INSERT INTO gstr1_filings (business_id, filing_period, filing_date, status)
           VALUES ($1, $2, $3, 'draft')
           RETURNING id`,
          [business_id, filingPeriod, filingDate]
        );
        filingId = newFiling.rows[0].id;
      }

      // Extract unique invoice IDs from the report data
      // We need to query invoices that match the filters to get their IDs
      let invoiceQuery = `
        SELECT DISTINCT i.id
        FROM invoices i
        WHERE i.business_id = $1
          AND i.deleted_at IS NULL
          AND i.status = 'final'
          AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
      `;
      const invoiceParams: any[] = [business_id];
      let paramIdx = 2;

      // Add branch filter if provided
      // Always filter by resolved branchId
      invoiceQuery += ` AND i.branch_id = $${paramIdx}`;
      invoiceParams.push(filters.branch_id);
      paramIdx++;

      if (filters.from_date && filters.to_date) {
        invoiceQuery += ` AND i.invoice_date BETWEEN $${paramIdx} AND $${paramIdx + 1}`;
        invoiceParams.push(filters.from_date, filters.to_date);
        paramIdx += 2;
      } else if (filters.month && filters.year) {
        const start = `${filters.year}-${filters.month.toString().padStart(2, '0')}-01`;
        invoiceQuery += ` AND i.invoice_date >= $${paramIdx}::date AND i.invoice_date < ($${paramIdx}::date + INTERVAL '1 month')`;
        invoiceParams.push(start);
        paramIdx += 1;
      }

      const invoiceResult = await client.query(invoiceQuery, invoiceParams);
      const invoiceIds = invoiceResult.rows.map(row => row.id);

      // Link invoices to filing (ignore duplicates)
      if (invoiceIds.length > 0) {
        await client.query(
          `INSERT INTO gstr1_filing_invoices (gstr1_filing_id, invoice_id)
           SELECT $1, unnest($2::uuid[])
           ON CONFLICT (gstr1_filing_id, invoice_id) DO NOTHING`,
          [filingId, invoiceIds]
        );
      }

      if (filters.month && filters.year) {
        const { replaceGstr1FilingDocuments } = await import('@/lib/gst/gstr1-filing-documents');
        await replaceGstr1FilingDocuments({
          client,
          filingId,
          businessId: business_id,
          branchId: finalBranchId,
          month: filters.month,
          year: filters.year,
        });
      }

      // Add filing_id to response
      (data as any).filing_id = filingId;
      (data as any).filing_period = filingPeriod;

      if (exportFormat === 'json') {
        // Fetch branch GSTIN if branch_id provided, otherwise use business GSTIN
        let gstin: string | null = null;
        
        if (finalBranchId) {
          const branchRes = await client.query(
            'SELECT gstin FROM branches WHERE id = $1 AND business_id = $2',
            [finalBranchId, business_id]
          );
          
          if (branchRes.rows.length > 0) {
            gstin = branchRes.rows[0].gstin;
          }
        }
        
        // Fallback to business GSTIN if branch GSTIN not found
        if (!gstin) {
          const businessRes = await client.query(
            'SELECT gstin FROM businesses WHERE id = $1',
            [business_id]
          );
          
          if (businessRes.rows.length === 0) {
            return NextResponse.json(
              { error: 'Business not found' },
              { status: 404 }
            );
          }
          
          gstin = businessRes.rows[0].gstin;
        }
        
        if (!gstin) {
          return NextResponse.json(
            { 
              error: 'GSTIN is required for GSTR-1 export',
              message: finalBranchId 
                ? 'Please set GSTIN for this branch in Branch Settings before exporting GSTR-1 reports.'
                : 'Please set your business GSTIN in Settings → Tax & GST tab before exporting GSTR-1 reports.',
              code: 'GSTIN_MISSING'
            },
            { status: 400 }
          );
        }
        
        const jsonContent = await generateGSTR1JSON(data, filters, gstin);
        
        return new NextResponse(jsonContent, {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="gstr1_${filters.month}_${filters.year}.json"`
          }
        });
      }
    } finally {
      client.release();
    }
    
    // Note: Excel export is handled by /api/reports/gst/gstr1/export/excel endpoint

    return NextResponse.json(data);

  } catch (error: any) {
    console.error('GSTR-1 Generation Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

