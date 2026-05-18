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

    // 1. Business row for PDF (logo must be absolute URL for Puppeteer)
    const businessRow = await db.queryOne<{
      name: string;
      address: string | null;
      city: string | null;
      gstin: string | null;
      logo_url: string | null;
    }>(
      `SELECT name, address_line1 as address, city, gstin, logo_url FROM businesses WHERE id = $1`,
      [businessId]
    );
    const business = businessRow
      ? {
          name: businessRow.name,
          address: businessRow.address,
          city: businessRow.city,
          gstin: businessRow.gstin,
          logo_url: absoluteUrlForServerSideAsset(businessRow.logo_url, req),
        }
      : null;

    // 2. Fetch balance sheet JSON (forward cookies so middleware auth succeeds on self-fetch)
    const qs = new URLSearchParams({
      business_id: businessId,
      user_id: userId,
      as_on_date: asOnDate,
      branch_id: finalBranchId,
    });
    if (financialYear) qs.set('financial_year', financialYear);
    const apiRes = await internalApiFetchFromRequest(
      req,
      `/api/reports/balance-sheet?${qs.toString()}`
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      let message = 'Failed to fetch balance sheet data';
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

    // 3. Format data for template
    const formatCurr = (val: any) => Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    
    // Process data for easier template usage
    const templateData = {
      business,
      data: {
        ...data,
        as_on_date: format(new Date(data.as_on_date), 'dd MMM yyyy'),
        assets: {
          ...data.assets,
          total: formatCurr(data.assets.total),
          current: {
            ...data.assets?.current,
            inventory: data.assets?.current?.inventory ? formatCurr(data.assets.current.inventory) : null,
            receivables: data.assets?.current?.receivables ? formatCurr(data.assets.current.receivables) : null,
            total: formatCurr(data.assets?.current?.total),
            accounts: (data.assets?.current?.accounts || []).map((a: any) => ({ ...a, balance: formatCurr(a.balance) }))
          },
          fixed: {
            ...data.assets?.fixed,
            gross_block: data.assets?.fixed?.gross_block ? formatCurr(data.assets.fixed.gross_block) : null,
            accumulated_depreciation: data.assets?.fixed?.accumulated_depreciation ? formatCurr(data.assets.fixed.accumulated_depreciation) : null,
            net_block: data.assets?.fixed?.net_block ? formatCurr(data.assets.fixed.net_block) : null,
            total: formatCurr(data.assets?.fixed?.total),
            accounts: (data.assets?.fixed?.accounts || []).map((a: any) => ({ ...a, balance: formatCurr(a.balance) })),
            details: (data.assets?.fixed?.assets || []).map((a: any) => ({ ...a, net_block: formatCurr(a.net_block) }))
          }
        },
        liabilities: {
          ...data.liabilities,
          total: formatCurr(data.liabilities?.total),
          current: {
            ...data.liabilities?.current,
            payables: data.liabilities?.current?.payables ? formatCurr(data.liabilities.current.payables) : null,
            total: formatCurr(data.liabilities?.current?.total),
            accounts: (data.liabilities?.current?.accounts || []).map((a: any) => ({ ...a, balance: formatCurr(Math.abs(a.balance)) }))
          },
          long_term: {
            ...data.liabilities?.long_term,
            total: formatCurr(data.liabilities?.long_term?.total),
            accounts: (data.liabilities?.long_term?.accounts || []).map((a: any) => ({ ...a, balance: formatCurr(Math.abs(a.balance)) }))
          }
        },
        equity: {
          ...data.equity,
          total: formatCurr(data.equity?.total),
          capital: {
            ...data.equity?.capital,
            accounts: (data.equity?.capital?.accounts || []).map((a: any) => ({ ...a, balance: formatCurr(Math.abs(a.balance)) }))
          },
          retained_earnings_amount: formatCurr(typeof data.equity?.retained_earnings === 'object' ? data.equity.retained_earnings.closing : (data.equity?.retained_earnings || 0))
        },
        total_liabilities_and_equity: formatCurr(data.total_liabilities_and_equity),
        difference: formatCurr(Math.abs((data.assets?.total || 0) - (data.total_liabilities_and_equity || 0)))
      },
      generated_at: format(new Date(), 'dd MMM yyyy HH:mm')
    };

    const renderer = new InvoiceRenderer();
    let html = await renderer.renderHtml('balance_sheet', templateData as any);
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

    // inline=1: open in browser tab for print preview; default attachment: save file on Download
    const openInBrowser = searchParams.get('inline') === '1';
    const filename = `Balance-Sheet-${asOnDate}.pdf`;
    return new NextResponse(pdfBuffer as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': openInBrowser
          ? `inline; filename="${filename}"`
          : `attachment; filename="${filename}"`,
      },
    });

  } catch (error: any) {
    console.error('Error generating Balance Sheet PDF:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

