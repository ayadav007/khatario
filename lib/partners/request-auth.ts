import { NextRequest, NextResponse } from 'next/server';
import {
  getPartnerSessionFromRequest,
  type PartnerSession,
} from '@/lib/partners/session';

export async function requirePartnerRequest(
  request: NextRequest,
): Promise<{ ok: true; session: PartnerSession } | { ok: false; response: NextResponse }> {
  const session = await getPartnerSessionFromRequest(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Partner authentication required', code: 'UNAUTHENTICATED_PARTNER' },
        { status: 401 },
      ),
    };
  }
  return { ok: true, session };
}
