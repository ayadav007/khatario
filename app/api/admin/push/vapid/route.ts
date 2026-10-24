import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { ensureVapidKeys, getVapidPublicKey } from '@/lib/platform-push';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'viewer');
  if (!auth.ok) return auth.response;

  try {
    let publicKey = await getVapidPublicKey();
    if (!publicKey) {
      publicKey = (await ensureVapidKeys()).publicKey;
    }
    return NextResponse.json({ publicKey });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
