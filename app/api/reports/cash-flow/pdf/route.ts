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
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');

    if (!businessId || !fromDate || !toDate) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
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

    const cfQs = new URLSearchParams({
      business_id: businessId,
      user_id: userId,
      from_date: fromDate,
      to_date: toDate,
      branch_id: finalBranchId,
    });
    const apiRes = await internalApiFetchFromRequest(
      req,
      `/api/reports/cash-flow?${cfQs.toString()}`
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      let message = 'Failed to fetch cash flow data';
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
        period: {
          from_date: format(new Date(data.period.from_date), 'dd MMM yyyy'),
          to_date: format(new Date(data.period.to_date), 'dd MMM yyyy')
        },
        opening_cash_balance: formatCurr(data.opening_cash_balance),
        operating_activities: {
          ...data.operating_activities,
          net_profit: formatCurr(data.operating_activities.net_profit),
          depreciation: formatCurr(data.operating_activities.depreciation),
          changes_in_working_capital: {
            receivables_increase: data.operating_activities.changes_in_working_capital.receivables_increase ? formatCurr(data.operating_activities.changes_in_working_capital.receivables_increase) : null,
            receivables_decrease: data.operating_activities.changes_in_working_capital.receivables_decrease ? formatCurr(data.operating_activities.changes_in_working_capital.receivables_decrease) : null,
            payables_increase: data.operating_activities.changes_in_working_capital.payables_increase ? formatCurr(data.operating_activities.changes_in_working_capital.payables_increase) : null,
            payables_decrease: data.operating_activities.changes_in_working_capital.payables_decrease ? formatCurr(data.operating_activities.changes_in_working_capital.payables_decrease) : null,
          },
          net_cash_from_operating: formatCurr(data.operating_activities.net_cash_from_operating)
        },
        investing_activities: {
          ...data.investing_activities,
          fixed_asset_purchases: data.investing_activities.fixed_asset_purchases ? formatCurr(data.investing_activities.fixed_asset_purchases) : null,
          fixed_asset_sales: data.investing_activities.fixed_asset_sales ? formatCurr(data.investing_activities.fixed_asset_sales) : null,
          net_cash_from_investing: formatCurr(data.investing_activities.net_cash_from_investing)
        },
        financing_activities: {
          ...data.financing_activities,
          capital_introduced: data.financing_activities.capital_introduced ? formatCurr(data.financing_activities.capital_introduced) : null,
          loans_taken: data.financing_activities.loans_taken ? formatCurr(data.financing_activities.loans_taken) : null,
          net_cash_from_financing: formatCurr(data.financing_activities.net_cash_from_financing)
        },
        net_cash_flow: formatCurr(data.net_cash_flow),
        net_cash_flow_is_positive: data.net_cash_flow >= 0,
        closing_cash_balance: formatCurr(data.closing_cash_balance),
        net_profit_is_positive: data.operating_activities.net_profit >= 0,
        net_operating_is_positive: data.operating_activities.net_cash_from_operating >= 0,
        net_investing_is_positive: data.investing_activities.net_cash_from_investing >= 0,
        net_financing_is_positive: data.financing_activities.net_cash_from_financing >= 0,
      },
      generated_at: format(new Date(), 'dd MMM yyyy HH:mm')
    };

    const renderer = new InvoiceRenderer();
    let html = await renderer.renderHtml('cash_flow', templateData as any);
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
    const filename = `Cash-Flow-${fromDate}-to-${toDate}.pdf`;
    return new NextResponse(pdfBuffer as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': openInBrowser
          ? `inline; filename="${filename}"`
          : `attachment; filename="${filename}"`,
      },
    });

  } catch (error: any) {
    console.error('Error generating Cash Flow PDF:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

