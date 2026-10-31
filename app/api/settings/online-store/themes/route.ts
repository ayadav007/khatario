import { NextRequest, NextResponse } from 'next/server';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { createTheme, listThemes } from '@/lib/store/engine/themes-repo';
import { presetContextFor } from '@/lib/store/engine/preset-context';
import { migrationInputFor } from '@/lib/store/engine/migrate-runner';
import { isUuid, repoJson } from '@/lib/store/engine/route-utils';
import type { ThemePreset } from '@/lib/store/engine/types';

export const dynamic = 'force-dynamic';

const PRESETS: ThemePreset[] = ['studio', 'quick', 'grocery', 'khatario', 'blank'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;
  try {
    return NextResponse.json({ themes: await listThemes(tenant.businessId) });
  } catch (error) {
    console.error('themes GET:', error);
    return NextResponse.json({ error: 'Failed to load themes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const tenant = await requireTenantPermission(request, body.business_id, 'settings', 'update');
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;

  const name = typeof body.name === 'string' ? body.name : '';
  const preset = body.preset === undefined ? 'studio' : body.preset;
  if (typeof preset !== 'string' || !PRESETS.includes(preset as ThemePreset)) {
    return NextResponse.json({ error: 'Invalid preset' }, { status: 400 });
  }
  if (body.duplicate_of !== undefined && body.duplicate_of !== null && !isUuid(body.duplicate_of)) {
    return NextResponse.json({ error: 'Invalid duplicate_of' }, { status: 400 });
  }

  try {
    const result = await createTheme(tenant.businessId, tenant.userId, {
      name,
      preset: preset as ThemePreset,
      duplicateOf: typeof body.duplicate_of === 'string' ? body.duplicate_of : undefined,
      ctx: await presetContextFor(tenant.businessId),
      // D33: before the store's first theme, its migrated design goes live. The business comes from the session.
      migrate: await migrationInputFor(tenant.businessId),
    });
    return repoJson(result, 'theme', 201);
  } catch (error) {
    console.error('themes POST:', error);
    return NextResponse.json({ error: 'Failed to create theme' }, { status: 500 });
  }
}
