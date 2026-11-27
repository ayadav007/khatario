import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { Invoice } from '@/types/database';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { authorize } from '@/lib/authorization';
import { normaliseOwnAppUrl } from '@/lib/http/own-app-url';
import { resolvePublicRequestOrigin } from '@/lib/http/public-request-origin';
import { limitExceededResponse } from '@/lib/subscription/limit-response';
import {
  assertWhatsAppBaseAccess,
  assertWhatsAppManualAddon,
  withPremiumSubscriptionApi,
} from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * Send invoice via WhatsApp
 * POST /api/invoices/[id]/whatsapp
 *
 * Same checks as POST /api/whatsapp/send: session, invoice read permission, base WhatsApp feature,
 * custom text only where the send route allows it, document link on a configured app origin, daily cap.
 */
export const POST = withPremiumSubscriptionApi<{ id: string }>(
  {
    claimedBusinessId: ({ request }) => getSessionScopedBusinessId(request),
    afterSubscription: async (ctx) => {
      await authorize(ctx.userId, 'invoices', 'read', { businessId: ctx.businessId });
      return assertWhatsAppBaseAccess(ctx);
    },
  },
  async (ctx) => {
    const { request, businessId, params } = ctx;
    try {
      const invoiceId = params.id;
      let body: Record<string, unknown>;
      try {
        body = ((await request.json()) as Record<string, unknown>) ?? {};
      } catch {
        return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
      }
      const { pdf_url, custom_message } = body;

      // Get invoice with customer details
      const invoice = await queryOne<Invoice & { customer_phone?: string; business_id: string }>(`
        SELECT
          i.*,
          c.phone as customer_phone,
          i.business_id
        FROM invoices i
        LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
        WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL
      `, [invoiceId, businessId]);

      if (!invoice) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }

      if (!invoice.customer_phone) {
        return NextResponse.json(
          { error: 'Customer phone number not found' },
          { status: 400 }
        );
      }

      if (!pdf_url) {
        return NextResponse.json(
          { error: 'PDF URL is required' },
          { status: 400 }
        );
      }

      const documentUrl = normaliseOwnAppUrl(pdf_url, { requestOrigin: resolvePublicRequestOrigin(request) });
      if (!documentUrl) {
        return NextResponse.json(
          { error: 'Invalid document link', code: 'INVALID_PDF_URL' },
          { status: 400 }
        );
      }

      const limitBlock = await limitExceededResponse(businessId, 'whatsapp');
      if (limitBlock) return limitBlock;

      // Custom text only where the send route would accept it; otherwise the default text.
      const customAllowed =
        typeof custom_message === 'string' &&
        custom_message.trim() !== '' &&
        (await assertWhatsAppManualAddon(ctx)) === null;
      const message = customAllowed
        ? (custom_message as string)
        : `Hello! Please find your invoice ${invoice.invoice_number} attached.`;

      try {
        await sendWhatsAppMessage(
          businessId,
          invoice.customer_phone,
          message,
          documentUrl,
          'document'
        );

        return NextResponse.json({
          success: true,
          message: 'Invoice sent successfully via WhatsApp',
        });
      } catch (error: any) {
        return NextResponse.json(
          { error: error.message || 'Failed to send WhatsApp message' },
          { status: 500 }
        );
      }
    } catch (error: any) {
      console.error('Error sending invoice via WhatsApp:', error);
      return NextResponse.json(
        { error: error.message || 'Internal server error' },
        { status: 500 }
      );
    }
  },
);
