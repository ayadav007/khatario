import { NextRequest, NextResponse } from 'next/server';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { getPluginEntry } from '@/lib/integrations/catalog';
import { disconnect, getConnection, saveConnection } from '@/lib/integrations/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

const NOT_FOUND = () => NextResponse.json({ error: 'Integration not found' }, { status: 404 });
const FAIL_STATUS = { INVALID: 400, REJECTED: 400, UNREACHABLE: 502, TOKEN_TAKEN: 409 } as const;

function provider(id: string): string | null {
  return getPluginEntry(id)?.plugin?.provider ?? null;
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const { searchParams } = new URL(request.url);
  const tenant = await requireTenantPermission(request, searchParams.get('business_id'), 'settings', ['read', 'update']);
  if (!tenant.ok) return tenant.response;
  const p = provider(params.id);
  if (!p) return NOT_FOUND();
  try {
    return NextResponse.json({ connection: await getConnection(tenant.businessId, p) });
  } catch (err) {
    console.error('integrations GET failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not load the integration' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const obj = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const tenant = await requireTenantPermission(request, (obj?.business_id as string | undefined) ?? null, 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const p = provider(params.id);
  if (!p) return NOT_FOUND();
  const values = obj?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return NextResponse.json({ error: 'values must be an object', code: 'INVALID' }, { status: 400 });
  }
  try {
    const result = await saveConnection(tenant.businessId, params.id, values as Record<string, unknown>, tenant.userId);
    if (result.ok) return NextResponse.json({ connection: result.connection });
    return NextResponse.json({ error: result.error, code: result.code }, { status: FAIL_STATUS[result.code] });
  } catch (err) {
    console.error('integrations PUT failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not save the integration' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { searchParams } = new URL(request.url);
  const tenant = await requireTenantPermission(request, searchParams.get('business_id'), 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const p = provider(params.id);
  if (!p) return NOT_FOUND();
  try {
    const result = await disconnect(tenant.businessId, p);
    if (result.ok) return NextResponse.json({ ok: true });
    return NextResponse.json(
      {
        error: `${result.count} parcel(s) are still with Shiprocket. Disconnect once they are delivered or returned.`,
        code: 'IN_FLIGHT',
        count: result.count,
      },
      { status: 409 },
    );
  } catch (err) {
    console.error('integrations DELETE failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not disconnect the integration' }, { status: 500 });
  }
}
