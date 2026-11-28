import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { EinvoiceError, generateIrn, getEinvoiceView, parseEinvoiceEwb } from '@/lib/gst/einvoice';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: 'Invoice not found', code: 'NOT_FOUND' }, { status: 404 });

/** Session identity, then the invoices permission checked against the invoice's own branch. */
async function authorizeInvoice(
  request: NextRequest,
  invoiceId: string,
  action: 'read' | 'update',
): Promise<{ ok: true; userId: string; businessId: string } | { ok: false; response: NextResponse }> {
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return { ok: false, response: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  if (!UUID.test(invoiceId)) return { ok: false, response: notFound() };
  const inv = await getPool().query<{ branch_id: string | null }>(
    `SELECT branch_id FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [invoiceId, businessId],
  );
  if (!inv.rows.length) return { ok: false, response: notFound() };
  try {
    await authorize(userId, 'invoices', action, { businessId, branchId: inv.rows[0].branch_id || undefined, resourceId: invoiceId });
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, response: error.toNextResponse() };
    throw error;
  }
  return { ok: true, userId, businessId };
}

function errorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof EinvoiceError) {
    return NextResponse.json({ error: error.message, code: error.code, problems: error.problems ?? [] }, { status: error.status });
  }
  console.error(fallback, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** GET /api/invoices/[id]/einvoice: the invoice's e-invoice state and what to fix before generating it. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const auth = await authorizeInvoice(request, params.id, 'read');
    if (!auth.ok) return auth.response;
    const einvoice = await getEinvoiceView(auth.businessId, params.id);
    if (!einvoice) return notFound();
    return NextResponse.json({ einvoice });
  } catch (error) {
    return errorResponse(error, 'Failed to load the e-invoice');
  }
}

/**
 * POST /api/invoices/[id]/einvoice: generate the IRN through Masters India and store it.
 * Body: { ewb?: { distance_km, transport_mode, vehicle_number, is_odc, transporter_gstin, transporter_name,
 * transport_doc_number, transport_doc_date } } to get the e-way bill with it. The business and user
 * come from the session only.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const auth = await authorizeInvoice(request, params.id, 'update');
    if (!auth.ok) return auth.response;
    const planDenied = await denyIfFeatureMissing(auth.businessId, 'e_invoice');
    if (planDenied) return planDenied;
    const body = await request.json().catch(() => ({}));
    const ewb = parseEinvoiceEwb(body?.ewb);
    if (ewb) {
      const ewayDenied = await denyIfFeatureMissing(auth.businessId, 'eway_bill');
      if (ewayDenied) return ewayDenied;
    }
    const einvoice = await generateIrn(auth.businessId, auth.userId, params.id, { ewb });
    return NextResponse.json({ einvoice }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to generate the e-invoice');
  }
}
