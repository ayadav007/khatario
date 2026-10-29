import { NextRequest, NextResponse } from 'next/server';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { deleteTheme, getTheme, renameTheme, saveTheme } from '@/lib/store/engine/themes-repo';
import { isUuid, notFound, repoFailure, repoJson } from '@/lib/store/engine/route-utils';

export const dynamic = 'force-dynamic';

const PUT_MAX_BYTES = 600_000;

type Ctx = { params: { id: string } };

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: Ctx) {
  if (!isUuid(params.id)) return notFound();
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;
  try {
    const theme = await getTheme(tenant.businessId, params.id);
    return theme ? NextResponse.json({ theme }) : notFound();
  } catch (error) {
    console.error('themes/[id] GET:', error);
    return NextResponse.json({ error: 'Failed to load theme' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  if (!isUuid(params.id)) return notFound();
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > PUT_MAX_BYTES) return repoFailure('too_large');
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    body = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const tenant = await requireTenantPermission(request, body.business_id, 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;
  try {
    const updatedAt = typeof body.updated_at === 'string' ? body.updated_at : null;
    return repoJson(await saveTheme(tenant.businessId, tenant.userId, params.id, body.data, updatedAt), 'theme');
  } catch (error) {
    console.error('themes/[id] PUT:', error);
    return NextResponse.json({ error: 'Failed to save theme' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  if (!isUuid(params.id)) return notFound();
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  const tenant = await requireTenantPermission(request, body.business_id, 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 60) {
    return NextResponse.json({ error: 'Name must be 1 to 60 characters' }, { status: 400 });
  }
  try {
    return repoJson(await renameTheme(tenant.businessId, params.id, name), 'theme');
  } catch (error) {
    console.error('themes/[id] PATCH:', error);
    return NextResponse.json({ error: 'Failed to rename theme' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  if (!isUuid(params.id)) return notFound();
  const { searchParams } = new URL(request.url);
  const tenant = await requireTenantPermission(request, searchParams.get('business_id'), 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;
  try {
    const result = await deleteTheme(tenant.businessId, params.id);
    return result.ok ? NextResponse.json({ ok: true }) : repoFailure(result.code);
  } catch (error) {
    console.error('themes/[id] DELETE:', error);
    return NextResponse.json({ error: 'Failed to delete theme' }, { status: 500 });
  }
}
