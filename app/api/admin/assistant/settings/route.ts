import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import { SettingsUpdateSchema } from '@/lib/rag/admin';
import { getPlatformAssistantSettings, savePlatformAssistantSettings } from '@/lib/rag/settings';

export const dynamic = 'force-dynamic';

/** PUT /api/admin/assistant/settings — turn assistant channels on or off. */
export async function PUT(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;

  const parsed = SettingsUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid settings' }, { status: 400 });

  const current = await getPlatformAssistantSettings();
  const next = { ...current, channels: { ...current.channels, ...parsed.data.channels } };
  await savePlatformAssistantSettings(next);

  await logAdminAction(
    auth.admin.id,
    'update_assistant_settings',
    'assistant_settings',
    undefined,
    { scope: 'platform', channels: next.channels },
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    request.headers.get('user-agent') || undefined,
  );
  return NextResponse.json({ settings: next });
}
