import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { sanitizeStoreTheme } from '@/lib/store/store-theme';
import { signThemeDraft } from '@/lib/store/theme-draft';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const tenant = requireTenantBusinessId(request, body.business_id);
  if (!tenant.ok) return tenant.response;
  const theme = sanitizeStoreTheme(body.theme);
  const token = signThemeDraft(tenant.businessId, theme);
  return NextResponse.json({ token });
}
