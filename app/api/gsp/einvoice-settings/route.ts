import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { EinvoiceSettingError, listEinvoiceRegistrations, setEinvoiceFrom } from '@/lib/gst/einvoice-settings';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = await requireTenantPermission(request, searchParams.get('business_id'), 'settings', 'read');
  if (!tenant.ok) return tenant.response;
  const denied = await denyIfFeatureMissing(tenant.businessId, 'e_invoice');
  if (denied) return denied;
  try {
    const registrations = await listEinvoiceRegistrations(getPool(), tenant.businessId);
    return NextResponse.json({ registrations });
  } catch (err) {
    console.error('einvoice-settings GET failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not load the e-invoicing settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const obj = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const tenant = await requireTenantPermission(request, (obj?.business_id as string | undefined) ?? null, 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const denied = await denyIfFeatureMissing(tenant.businessId, 'e_invoice');
  if (denied) return denied;

  const key = obj?.key;
  const date = obj?.einvoice_from;
  if (typeof key !== 'string' || !key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 });
  }
  if (date !== null && typeof date !== 'string') {
    return NextResponse.json({ error: 'einvoice_from must be a date or null' }, { status: 400 });
  }
  try {
    await setEinvoiceFrom(getPool(), tenant.businessId, key, date === '' ? null : date);
    return NextResponse.json({ registrations: await listEinvoiceRegistrations(getPool(), tenant.businessId) });
  } catch (err) {
    if (err instanceof EinvoiceSettingError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('einvoice-settings PUT failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not save the e-invoicing settings' }, { status: 500 });
  }
}
