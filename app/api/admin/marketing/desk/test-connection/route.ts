import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { testMarketingConnection } from '@/lib/marketing/meta-graph';
import { loadMarketingSecrets } from '@/lib/marketing/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const secrets = await loadMarketingSecrets();
  if (!secrets.accessToken) {
    return NextResponse.json({ error: 'Add an access token in Setup first' }, { status: 400 });
  }
  try {
    const result = await testMarketingConnection({
      token: secrets.accessToken,
      pageId: secrets.pageId,
      instagramUserId: secrets.instagramUserId,
      adAccountId: secrets.adAccountId,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Connection test failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
