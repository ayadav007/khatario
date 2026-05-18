import { NextRequest, NextResponse } from 'next/server';
import { generateInvoicePdf } from '@/lib/pdf-generator';
import {
  ensureInvoicePublicToken,
  resolveInvoiceByPublicToken,
} from '@/lib/customer-surface';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 60_000;

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`public-invoice-pdf:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
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
      await ensureInvoicePublicToken(resolved.invoice_id);
    }

    const pdfBuffer = await generateInvoicePdf(resolved.invoice_id);
    const safeName = resolved.summary.invoice_number.replace(/[^\w.-]+/g, '_');

    return new NextResponse(pdfBuffer as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice-${safeName}.pdf"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error: unknown) {
    console.error('[public/i/pdf] error:', error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
