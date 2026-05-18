import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { InvoiceRenderer } from '@/lib/invoice-renderer';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { format } from 'date-fns';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { internalApiFetchFromRequest } from '@/lib/internal-api-fetch';
import { absoluteUrlForServerSideAsset } from '@/lib/absolute-asset-url';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = getBusinessIdFromRequest(req);
    const userId = getUserIdFromRequest(req);
    const branchIdParam = searchParams.get('branch_id');
    const asOnDate = searchParams.get('as_on_date') || format(new Date(), 'yyyy-MM-dd');
    const financialYear = searchParams.get('financial_year');

    if (!businessId) {
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
      await assertReportAccess(businessId, 'advanced');
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
        businessId: businessId,
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

    // AUTHORIZATION: Check export permission for financial report
    try {
      await authorize(userId, 'report.financial', 'export', {
        businessId,
        branchId: finalBranchId,
        resource: {
          business_id: businessId,
          branch_id: finalBranchId,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const businessRow = await db.queryOne<{
      name: string;
      address: string | null;
      city: string | null;
      logo_url: string | null;
    }>(
      `SELECT name, address_line1 as address, city, logo_url FROM businesses WHERE id = $1`,
      [businessId]
    );
    const business = businessRow
      ? {
          name: businessRow.name,
          address: businessRow.address,
          city: businessRow.city,
          logo_url: absoluteUrlForServerSideAsset(businessRow.logo_url, req),
        }
      : null;

    const tbQs = new URLSearchParams({
      business_id: businessId,
      user_id: userId,
      as_on_date: asOnDate,
      branch_id: finalBranchId,
    });
    if (financialYear) tbQs.set('financial_year', financialYear);
    const apiRes = await internalApiFetchFromRequest(
      req,
      `/api/reports/trial-balance?${tbQs.toString()}`
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      let message = 'Failed to fetch trial balance data';
      try {
        const j = JSON.parse(errText);
        if (j.error) message = typeof j.error === 'string' ? j.error : message;
        if (j.message) message = j.message;
      } catch {
        if (errText) message = errText.slice(0, 200);
      }
      throw new Error(message);
    }
    const data = await apiRes.json();

    // 3. Format data
    const formatCurr = (val: any) => Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    
    const templateData = {
      business,
      data: {
        ...data,
        as_on_date: format(new Date(data.as_on_date), 'dd MMM yyyy'),
        accounts: (data.accounts || []).map((a: any) => ({
          ...a,
          debit: a.debit > 0 ? formatCurr(a.debit) : null,
          credit: a.credit > 0 ? formatCurr(a.credit) : null
        })),
        totals: {
          total_debit: formatCurr(data.totals?.total_debit),
          total_credit: formatCurr(data.totals?.total_credit)
        },
        difference: formatCurr(Math.abs((data.totals?.total_debit || 0) - (data.totals?.total_credit || 0)))
      },
      generated_at: format(new Date(), 'dd MMM yyyy HH:mm')
    };

    const renderer = new InvoiceRenderer();
    let html = await renderer.renderHtml('trial_balance', templateData as any);
    const { maybeAppendKhatarioPrintFooter } = await import('@/lib/print-branding');
    html = await maybeAppendKhatarioPrintFooter(html, businessId);

    // 4. Generate PDF
    const browser = await puppeteer.launch(
      getPuppeteerLaunchOptions({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    );
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    const openInBrowser = searchParams.get('inline') === '1';
    const filename = `Trial-Balance-${asOnDate}.pdf`;
    return new NextResponse(pdfBuffer as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': openInBrowser
          ? `inline; filename="${filename}"`
          : `attachment; filename="${filename}"`,
      },
    });

  } catch (error: any) {
    console.error('Error generating Trial Balance PDF:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

