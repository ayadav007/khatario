import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { sendPlatformAdminPush } from '@/lib/platform-push';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'viewer');
  if (!auth.ok) return auth.response;

  try {
    const sent = await sendPlatformAdminPush({
      event: 'incident',
      title: 'Test notification',
      body: `Hello ${auth.admin.name} — admin push is working.`,
      url: '/admin/settings',
      force: true,
    });
    return NextResponse.json({ ok: true, sent });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
