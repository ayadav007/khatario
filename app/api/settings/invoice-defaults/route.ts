import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getAuthenticatedUserId, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { sanitizeInvoiceDefaults } from '@/lib/settings/invoice-defaults';

export const dynamic = 'force-dynamic';

/** GET /api/settings/invoice-defaults: defaults for new bills (session business only). */
export async function GET(request: NextRequest) {
  const tenant = requireTenantBusinessId(request);
  if (!tenant.ok) return tenant.response;
  const row = await queryOne<{ invoice_defaults: unknown }>(
    `SELECT invoice_defaults FROM business_settings WHERE business_id = $1`,
    [tenant.businessId],
  ).catch(() => null);
  return NextResponse.json({ defaults: sanitizeInvoiceDefaults(row?.invoice_defaults) });
}

/** PUT /api/settings/invoice-defaults { defaults }: merges into the saved defaults. Needs settings rights. */
export async function PUT(request: NextRequest) {
  const tenant = requireTenantBusinessId(request);
  if (!tenant.ok) return tenant.response;
  const userId = getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await authorize(userId, 'settings', 'update', { businessId: tenant.businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const incoming = (body.defaults ?? body) as Record<string, unknown>;
  const current = await queryOne<{ invoice_defaults: unknown }>(
    `SELECT invoice_defaults FROM business_settings WHERE business_id = $1`,
    [tenant.businessId],
  );
  const merged = sanitizeInvoiceDefaults({ ...sanitizeInvoiceDefaults(current?.invoice_defaults), ...incoming });
  await query(
    `INSERT INTO business_settings (business_id, invoice_defaults) VALUES ($1, $2::jsonb)
     ON CONFLICT (business_id) DO UPDATE SET invoice_defaults = EXCLUDED.invoice_defaults, updated_at = CURRENT_TIMESTAMP`,
    [tenant.businessId, JSON.stringify(merged)],
  );
  return NextResponse.json({ defaults: merged });
}
