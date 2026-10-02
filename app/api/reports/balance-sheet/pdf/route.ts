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

export const dynamic = 'force-dynamic';

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

    // Same scope as the screen: no branch_id (or ALL) is the consolidated sheet.
    const isConsolidatedView = !branchIdParam || branchIdParam.toLowerCase() === 'all';
    let finalBranchId: string | undefined;
    if (!isConsolidatedView) {
      const { resolveBranchId } = await import('@/lib/branch-helpers');
      try {
        finalBranchId = await resolveBranchId({ branchId: branchIdParam, businessId });
      } catch (error: any) {
        if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error.code === 'NO_DEFAULT_BRANCH') {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        throw error;
      }
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
    });
    if (finalBranchId) qs.set('branch_id', finalBranchId);
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

    // 3. Format data for template (negative balances in brackets, zero rows dropped)
    const formatCurr = (val: any) => {
      const n = Number(val || 0);
      const s = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return n < -0.004 ? `(${s})` : s;
    };
    const fmtSection = (s: any, title: string) => ({
      title,
      total: formatCurr(s?.total),
      has_rows: (s?.accounts || []).some((a: any) => Math.abs(Number(a.balance) || 0) >= 0.005) || Math.abs(Number(s?.total) || 0) >= 0.005,
      accounts: (s?.accounts || [])
        .filter((a: any) => Math.abs(Number(a.balance) || 0) >= 0.005)
        .map((a: any) => ({ ...a, balance: formatCurr(a.balance) })),
    });
    const re = data.equity?.retained_earnings || {};
    const invAdj = Number(data.assets?.current?.inventory_adjustment || 0);

    const templateData = {
      business,
      data: {
        ...data,
        as_on_date: format(new Date(data.as_on_date), 'dd MMM yyyy'),
        asset_sections: [
          fmtSection(data.assets?.current, 'Current Assets'),
          fmtSection(data.assets?.fixed, 'Fixed Assets'),
          fmtSection(data.assets?.investments, 'Investments'),
          fmtSection(data.assets?.other, 'Other Assets'),
        ].filter((s, i) => i === 0 || s.has_rows),
        inventory_adjustment: Math.abs(invAdj) >= 0.005 ? formatCurr(invAdj) : null,
        liability_sections: [
          fmtSection(data.liabilities?.current, 'Current Liabilities'),
          fmtSection(data.liabilities?.long_term, 'Long-term Liabilities'),
          fmtSection(data.liabilities?.other, 'Other Liabilities'),
        ].filter((s, i) => i === 0 || s.has_rows),
        equity_accounts: fmtSection(data.equity?.capital, 'Equity').accounts,
        previous_years_profit: Math.abs(Number(re.opening || 0)) >= 0.005 ? formatCurr(re.opening) : null,
        current_year_earnings: formatCurr(re.current_year_profit),
        assets_total: formatCurr(data.assets?.total),
        liabilities_total: formatCurr(data.liabilities?.total),
        equity_total: formatCurr(data.equity?.total),
        total_liabilities_and_equity: formatCurr(data.total_liabilities_and_equity),
        difference: formatCurr(Math.abs((data.assets?.total || 0) - (data.total_liabilities_and_equity || 0))),
      },
      generated_at: format(new Date(), 'dd MMM yyyy HH:mm'),
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

