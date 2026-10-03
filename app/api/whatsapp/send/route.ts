import { NextResponse } from 'next/server';
import { getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { generateInvoicePdf } from '@/lib/pdf-generator';
import { queryOne } from '@/lib/db';
import { sendEventTemplate } from '@/lib/whatsapp/tenant-send';
import { invoiceEventValues } from '@/lib/whatsapp/invoice-event-values';
import { limitExceededResponse } from '@/lib/subscription/limit-response';
import {
  assertWhatsAppBaseAccess,
  assertWhatsAppManualAddon,
  isTransactionalWhatsAppSend,
  withPremiumSubscriptionApi,
} from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

export const POST = withPremiumSubscriptionApi(
  {
    claimedBusinessId: ({ request }) => getBusinessIdFromRequest(request),
    afterSubscription: async (ctx) => {
      try {
        const contentType = ctx.request.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const peek = await ctx.request.clone().json();
          if (isTransactionalWhatsAppSend(peek)) {
            return assertWhatsAppBaseAccess(ctx);
          }
        }
      } catch {
        /* fall through to manual gate */
      }
      return assertWhatsAppManualAddon(ctx);
    },
  },
  async ({ request, businessId }) => {
    try {
      const limitBlock = await limitExceededResponse(businessId, 'whatsapp');
      if (limitBlock) return limitBlock;

      const contentType = request.headers.get('content-type') || '';
      let body: Record<string, unknown>;

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        body = {
          to: formData.get('to') as string,
          message: formData.get('message') as string,
          message_type: formData.get('message_type') as string,
          image: formData.get('image') as File | null,
        };
      } else {
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
        }
      }

      const {
        to,
        message,
        mediaUrl,
        invoiceId,
        message_type,
        buttons,
        image,
        footer,
      } = body as {
        to?: string;
        message?: string;
        mediaUrl?: string;
        invoiceId?: string;
        message_type?: string;
        buttons?: unknown;
        image?: File | null;
        footer?: string;
      };

      if (!to || !message) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      let formattedButtons:
        | Array<{
            id: string;
            title: string;
            type?: 'quick_reply' | 'call' | 'url';
            phone?: string;
            url?: string;
          }>
        | undefined;

      if (message_type === 'button' && buttons) {
        formattedButtons = [];

        if (
          typeof buttons === 'object' &&
          buttons !== null &&
          ('quickReplies' in buttons || 'callToActions' in buttons)
        ) {
          const buttonObj = buttons as {
            quickReplies?: string[];
            callToActions?: {
              phone?: { title?: string; phone?: string };
              url?: { title?: string; url?: string };
            };
          };

          if (buttonObj.quickReplies && Array.isArray(buttonObj.quickReplies)) {
            buttonObj.quickReplies.forEach((title: string, index: number) => {
              if (title.trim()) {
                formattedButtons!.push({
                  id: `quick_reply_${index}`,
                  title: title.trim(),
                  type: 'quick_reply',
                });
              }
            });
          }

          if (buttonObj.callToActions) {
            if (buttonObj.callToActions.phone?.title && buttonObj.callToActions.phone?.phone) {
              formattedButtons!.push({
                id: 'call_button',
                title: buttonObj.callToActions.phone.title,
                type: 'call',
                phone: buttonObj.callToActions.phone.phone,
              });
            }

            if (buttonObj.callToActions.url?.title && buttonObj.callToActions.url?.url) {
              formattedButtons!.push({
                id: 'url_button',
                title: buttonObj.callToActions.url.title,
                type: 'url',
                url: buttonObj.callToActions.url.url,
              });
            }
          }
        } else if (Array.isArray(buttons)) {
          formattedButtons = buttons as typeof formattedButtons;
        }
      }

      let imageBuffer: Buffer | undefined;
      if (image && image instanceof File) {
        const arrayBuffer = await image.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      }

      let media: string | Buffer | undefined = mediaUrl || imageBuffer;

      if (invoiceId) {
        const invoice = await queryOne<{
          id: string;
          invoice_number: string | null;
          grand_total: string | null;
          balance_amount: string | null;
          due_date: string | null;
          customer_name: string | null;
          business_name: string | null;
        }>(
          `SELECT i.id, i.invoice_number, i.grand_total, i.balance_amount, i.due_date,
                  c.name AS customer_name, b.name AS business_name
           FROM invoices i
           LEFT JOIN customers c ON c.id = i.customer_id
           JOIN businesses b ON b.id = i.business_id
           WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL`,
          [String(invoiceId), businessId],
        );
        if (!invoice) {
          return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
        }
        try {
          media = await generateInvoicePdf(String(invoiceId));
        } catch (e) {
          console.error('Failed to generate PDF for WhatsApp:', e);
          return NextResponse.json({ error: 'Failed to generate invoice PDF' }, { status: 500 });
        }
        const viaTemplate = await sendEventTemplate({
          businessId,
          eventKey: 'invoice_sent',
          to,
          values: await invoiceEventValues(invoice),
          document: { buffer: media, filename: `${invoice.invoice_number || 'invoice'}.pdf` },
        });
        if (viaTemplate.sent) {
          return NextResponse.json({ success: true, via: 'cloud', template: viaTemplate.template });
        }
      }

      await sendWhatsAppMessage(
        businessId,
        to,
        message,
        media,
        (message_type || 'text') as 'text' | 'button' | 'image' | 'document',
        formattedButtons,
        footer,
      );

      return NextResponse.json({ success: true });
    } catch (error: unknown) {
      console.error('Error sending WA message:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Send failed' },
        { status: 500 },
      );
    }
  },
);
