import { NextRequest, NextResponse } from 'next/server';
import { finalizePrintHtml, generateInvoiceHtml } from '@/lib/pdf-generator';
import {
  ensureInvoicePublicToken,
  resolveInvoiceByPublicToken,
} from '@/lib/customer-surface';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

/**
 * GET /api/public/i/[token]
 * Public invoice metadata + rendered HTML (no staff session).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`public-invoice:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfterMs: rl.retryAfterMs },
      { status: 429 }
    );
  }

  try {
    let resolved = await resolveInvoiceByPublicToken(params.token);
    if (!resolved) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (!resolved.public_token) {
      const token = await ensureInvoicePublicToken(resolved.invoice_id);
      resolved = (await resolveInvoiceByPublicToken(token)) ?? resolved;
    }

    const { html, templateId, settings, businessId } = await generateInvoiceHtml(
      resolved.invoice_id
    );
    const finalizedHtml = await finalizePrintHtml(html, templateId, settings, businessId);

    return NextResponse.json({
      invoice_id: resolved.invoice_id,
      public_token: resolved.public_token,
      summary: resolved.summary,
      business: resolved.business,
      html: finalizedHtml,
    });
  } catch (error: unknown) {
    console.error('[public/i] GET error:', error);
    return NextResponse.json({ error: 'Failed to load invoice' }, { status: 500 });
  }
}
