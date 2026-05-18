import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { GSTR1Generator } from '@/lib/gst/gstr1';
import { buildGstr1Snapshot } from '@/lib/gst/gstr1-snapshot';
import { replaceGstr1FilingDocuments } from '@/lib/gst/gstr1-filing-documents';

export async function POST(
  request: NextRequest,
  { params }: { params: { filingId: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const { filingId } = params;
    const body = await request.json();
    const { lock_date, branch_id: bodyBranchId } = body;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    const filingRes = await client.query(
      `SELECT id, business_id, filing_period, status, lock_date 
       FROM gstr1_filings 
       WHERE id = $1`,
      [filingId]
    );

    if (filingRes.rows.length === 0) {
      return NextResponse.json({ error: 'Filing not found' }, { status: 404 });
    }

    const filing = filingRes.rows[0];

    if (filing.status === 'filed') {
      return NextResponse.json({ error: 'Filing is already marked as filed' }, { status: 400 });
    }

    try {
      await assertReportAccess(filing.business_id, 'gst');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: bodyBranchId || undefined,
        businessId: filing.business_id,
      });
    } catch (error: any) {
      if (
        error.code === 'BRANCH_NOT_FOUND' ||
        error.code === 'BRANCH_BUSINESS_MISMATCH' ||
        error.code === 'BRANCH_INACTIVE'
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      throw error;
    }

    try {
      await authorize(userId, 'report.gst', 'read', {
        businessId: filing.business_id,
        branchId: finalBranchId,
        resource: {
          business_id: filing.business_id,
          branch_id: finalBranchId,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let finalLockDate: string;
    if (lock_date) {
      finalLockDate = lock_date;
    } else {
      const [year, month] = filing.filing_period.split('-');
      const lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0);
      finalLockDate = lastDay.toISOString().split('T')[0];
    }

    const periodParts = /^(\d{4})-(\d{2})$/.exec(filing.filing_period);
    if (!periodParts) {
      return NextResponse.json({ error: 'Invalid filing_period on record' }, { status: 500 });
    }
    const periodYear = parseInt(periodParts[1], 10);
    const periodMonth = parseInt(periodParts[2], 10);

    await client.query('BEGIN');

    try {
      const gen = new GSTR1Generator();
      const bundle = await gen.generate({
        business_id: filing.business_id,
        branch_id: finalBranchId,
        month: periodMonth,
        year: periodYear,
      });
      const snapshot = buildGstr1Snapshot(bundle, {
        generatedAt: new Date().toISOString(),
        gstPeriod: filing.filing_period,
        businessId: filing.business_id,
        branchId: finalBranchId,
      });

      await replaceGstr1FilingDocuments({
        client,
        filingId,
        businessId: filing.business_id,
        branchId: finalBranchId,
        month: periodMonth,
        year: periodYear,
      });

      await client.query(
        `UPDATE gstr1_filings 
         SET status = 'filed', 
             lock_date = $1::date, 
             filing_date = CURRENT_DATE,
             filed_by = $2::uuid,
             gstr1_snapshot = $3::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4::uuid`,
        [finalLockDate, userId, JSON.stringify(snapshot), filingId]
      );

      const invoiceRes = await client.query(
        `SELECT invoice_id FROM gstr1_filing_invoices WHERE gstr1_filing_id = $1`,
        [filingId]
      );
      const invoiceIds = invoiceRes.rows.map((row) => row.invoice_id);

      if (invoiceIds.length > 0) {
        await client.query(`UPDATE invoices SET is_editable = false WHERE id = ANY($1::uuid[])`, [
          invoiceIds,
        ]);
      }

      await client.query(
        `UPDATE invoices 
         SET is_editable = false 
         WHERE business_id = $1::uuid
           AND invoice_date <= $2::date
           AND status = 'final'
           AND is_editable = true`,
        [filing.business_id, finalLockDate]
      );

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        message: 'GSTR-1 marked as filed; immutable snapshot stored',
        locked_invoices_count: invoiceIds.length,
        filing_period: filing.filing_period,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } catch (error: any) {
    console.error('Error marking GSTR-1 as filed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to mark filing as filed' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
