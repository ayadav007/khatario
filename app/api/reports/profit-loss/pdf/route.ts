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
import type { PlAccountNode, PlSectionBlock } from '@/lib/reports/profit-loss';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = getBusinessIdFromRequest(req);
    const userId = getUserIdFromRequest(req); // REQUIRED for authorization
    const branchIdParam = searchParams.get('branch_id'); // Optional: filter by branch
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

    // AUTHORIZATION: Check export permission for financial report (PBAC will check branch access, business ownership, accounting access)
    // Export requires elevated permissions - more restrictive than read
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

    const consolidated = !branchIdParam || branchIdParam.toUpperCase() === 'ALL';
    const plQs = new URLSearchParams({
      business_id: businessId,
      user_id: userId,
      from_date: fromDate,
      to_date: toDate,
      branch_id: consolidated ? 'ALL' : finalBranchId,
    });
    const financialYear = searchParams.get('financial_year');
    if (financialYear) plQs.set('financial_year', financialYear);
    const apiRes = await internalApiFetchFromRequest(
      req,
      `/api/reports/profit-loss?${plQs.toString()}`
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      let message = 'Failed to fetch P&L data';
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

    const templateData = {
      business,
      data: {
        period: {
          from_date: format(new Date(data.period.from_date), 'dd MMM yyyy'),
          to_date: format(new Date(data.period.to_date), 'dd MMM yyyy'),
        },
        branch_name: data.branch?.name ?? null,
        blocks: buildPdfBlocks(data),
      },
      generated_at: format(new Date(), 'dd MMM yyyy HH:mm'),
    };

    const renderer = new InvoiceRenderer();
    let html = await renderer.renderHtml('profit_loss', templateData as any);
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
    const filename = `Profit-Loss-${fromDate}-to-${toDate}.pdf`;
    return new NextResponse(pdfBuffer as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': openInBrowser
          ? `inline; filename="${filename}"`
          : `attachment; filename="${filename}"`,
      },
    });

  } catch (error: any) {
    console.error('Error generating P&L PDF:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

const formatCurr = (val: unknown) =>
  Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface PdfRow { label: string; code: string; amount: string; indent: number; inactive: boolean; subtotal: boolean }

function pdfRows(nodes: PlAccountNode[], depth = 0): PdfRow[] {
  return nodes.flatMap((n) => [
    { label: n.account_name, code: n.account_code, amount: formatCurr(n.amount), indent: depth * 16, inactive: !n.is_active, subtotal: false },
    ...pdfRows(n.children, depth + 1),
    ...(n.children.length
      ? [{ label: `Total for ${n.account_name}`, code: '', amount: formatCurr(n.total), indent: depth * 16, inactive: false, subtotal: true }]
      : []),
  ]);
}

/** Zoho order: sections with their totals, profit lines in between. */
function buildPdfBlocks(data: any) {
  const byKey = new Map<string, PlSectionBlock>((data.sections || []).map((s: PlSectionBlock) => [s.key, s]));
  const section = (key: string) => {
    const s = byKey.get(key);
    if (!s) return null;
    const rows = pdfRows(s.accounts);
    if (key === 'cost_of_goods_sold' && data.periodic_cogs) {
      const p = data.periodic_cogs;
      rows.unshift(
        { label: 'Opening Stock', code: '', amount: formatCurr(p.opening_stock), indent: 0, inactive: false, subtotal: false },
        { label: 'Add: Purchases (net of returns)', code: '', amount: formatCurr(p.purchases), indent: 0, inactive: false, subtotal: false },
        { label: 'Less: Closing Stock', code: '', amount: `(${formatCurr(p.closing_stock)})`, indent: 0, inactive: false, subtotal: false },
      );
    }
    return { is_section: true, label: s.label, rows, total_label: `Total for ${s.label}`, total: formatCurr(s.total) };
  };
  const profit = (label: string, value: number, final = false) => ({
    is_section: false,
    label,
    amount: formatCurr(value),
    positive: Number(value) >= 0,
    final,
  });
  return [
    section('operating_income'),
    section('cost_of_goods_sold'),
    profit('Gross Profit', data.gross_profit),
    section('operating_expense'),
    profit('Operating Profit', data.operating_profit),
    section('other_income'),
    section('other_expense'),
    profit('Net Profit/Loss', data.net_profit, true),
    ...(data.earnings
      ? [
          profit('Profit Before Tax', data.earnings.profit_before_tax),
          profit('EBIT', data.earnings.ebit),
          profit('EBITDA', data.earnings.ebitda),
        ]
      : []),
  ].filter(Boolean);
}

