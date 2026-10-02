import { NextRequest, NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/platform-auth';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { loadMarketingSecrets, saveMarketingSettings, toPublicMarketingSettings } from '@/lib/marketing/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const secrets = await loadMarketingSecrets();
  return NextResponse.json({ settings: toPublicMarketingSettings(secrets) });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const settings = await saveMarketingSettings({
      access_token: typeof body.access_token === 'string' ? body.access_token : undefined,
      page_id: String(body.page_id || ''),
      instagram_user_id: String(body.instagram_user_id || ''),
      ad_account_id: String(body.ad_account_id || ''),
      pixel_id: String(body.pixel_id || ''),
      brief: body.brief,
    });
    await logAdminAction(auth.admin.id, 'marketing_settings_update', 'marketing_settings', undefined, {
      page_id: settings.page_id,
      has_access_token: settings.has_access_token,
    });
    return NextResponse.json({ settings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not save settings';
    const status = /SECRETS_ENCRYPTION_KEY|PAYMENT_ENCRYPTION_KEY/.test(message) ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
