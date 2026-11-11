import { NextRequest, NextResponse } from 'next/server';
import {
  recordTaxPayment,
  getTaxPayments,
  TaxProvisionNotFoundError,
} from '@/lib/services/tax-provision-calculator';
import { getAuthenticatedUserId, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne } from '@/lib/db';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';

export const dynamic = 'force-dynamic';

/**
 * Session user, session business and the accounting (journal) permission. The provision in
 * the path must belong to the session business; nothing else is ever read or written.
 */
async function requireProvisionAccess(
  request: NextRequest,
  provisionId: string,
  action: 'read' | 'create',
  claimedBusinessId?: string | null,
): Promise<{ ok: true; userId: string; businessId: string } | { ok: false; response: NextResponse }> {
  const tenant = requireTenantBusinessId(request, claimedBusinessId);
  if (!tenant.ok) return tenant;
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  try {
    await authorize(userId, 'journal', action, { businessId: tenant.businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, response: error.toNextResponse() };
    throw error;
  }
  const provision = await queryOne<{ id: string }>(
    `SELECT id FROM tax_provisions WHERE id = $1 AND business_id = $2`,
    [provisionId, tenant.businessId],
  );
  if (!provision) {
    return { ok: false, response: NextResponse.json({ error: 'Tax provision not found' }, { status: 404 }) };
  }
  return { ok: true, userId, businessId: tenant.businessId };
}

/**
 * GET /api/tax-provisions/[id]/payments
 * Payments recorded against one of this business's tax provisions.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const access = await requireProvisionAccess(request, params.id, 'read');
    if (!access.ok) return access.response;

    const payments = await getTaxPayments(params.id, access.businessId);
    return NextResponse.json({ payments });
  } catch (error: any) {
    console.error('Error fetching tax payments:', error);
    return NextResponse.json({ error: 'Failed to fetch tax payments' }, { status: 500 });
  }
}

/**
 * POST /api/tax-provisions/[id]/payments
 * Record a tax payment. The payer is the session user; a body user_id is ignored.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const {
      business_id,
      payment_date,
      payment_amount,
      payment_mode,
      challan_number,
      bank_name,
      reference_number,
      notes,
    } = body;

    const access = await requireProvisionAccess(request, params.id, 'create', business_id);
    if (!access.ok) return access.response;

    if (!payment_date || !payment_amount) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    const planDenied = await denyIfFeatureMissing(access.businessId, 'accounting_provisions');
    if (planDenied) return planDenied;

    const paymentId = await recordTaxPayment(
      access.businessId,
      params.id,
      payment_date,
      payment_amount,
      payment_mode,
      challan_number,
      bank_name,
      reference_number,
      notes,
      access.userId
    );

    return NextResponse.json({ id: paymentId }, { status: 201 });
  } catch (error: any) {
    if (error instanceof TaxProvisionNotFoundError) {
      return NextResponse.json({ error: 'Tax provision not found' }, { status: 404 });
    }
    console.error('Error recording tax payment:', error);
    return NextResponse.json({ error: 'Failed to record tax payment' }, { status: 500 });
  }
}
