import { NextRequest, NextResponse } from 'next/server';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { MetaWhatsAppError } from '@/lib/meta-whatsapp';
import { TenantTemplateError } from '@/lib/whatsapp/tenant-templates';
import { assertWhatsAppPremiumAddon } from '@/lib/security/whatsapp-api-gates';

export type TenantRouteContext = { userId: string; businessId: string };

/** Session-scoped business only; client-sent ids are never read. */
export async function withTenantTemplates(
  request: NextRequest,
  action: 'read' | 'update',
  handler: (ctx: TenantRouteContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    await authorize(session.userId, 'settings', action, { businessId: session.businessId });
    if (action === 'update') {
      const connectBlocked = await assertWhatsAppPremiumAddon({ businessId: session.businessId });
      if (connectBlocked) return connectBlocked;
    }
    return await handler({ userId: session.userId, businessId: session.businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    if (error instanceof TenantTemplateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof MetaWhatsAppError) {
      const message =
        error.code === 'META_WA_NOT_CONFIGURED'
          ? 'Save your Meta Cloud API credentials first.'
          : `Meta: ${error.message}`;
      return NextResponse.json({ error: message }, { status: error.code === 'META_WA_NOT_CONFIGURED' ? 400 : 502 });
    }
    console.error('[wa templates]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
