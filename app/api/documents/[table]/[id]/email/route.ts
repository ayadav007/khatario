import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { sendBusinessEmail, businessEmailNotConfiguredMessage } from '@/lib/business-email';
import { generateDocumentPdf, type DocumentTable } from '@/lib/pdf-generator';
import { pdfFilenameForDocument } from '@/lib/document-email-templates';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';

const VALID_TABLES: DocumentTable[] = [
  'invoices',
  'sales_orders',
  'delivery_challans',
  'credit_notes',
  'debit_notes',
  'purchase_orders',
  'work_orders',
];

function authorizeResourceForTable(table: DocumentTable): {
  resource: string;
  action: 'update' | 'read';
} {
  if (table === 'purchase_orders') return { resource: 'purchases', action: 'update' };
  if (table === 'invoices') return { resource: 'invoices', action: 'update' };
  if (table === 'sales_orders') return { resource: 'sales_orders', action: 'update' };
  return { resource: 'invoices', action: 'read' };
}

function documentNumberFromRow(table: DocumentTable, row: Record<string, unknown>): string {
  if (table === 'invoices') return String(row.invoice_number ?? row.id);
  if (table === 'delivery_challans') return String(row.challan_number ?? row.id);
  return String(row.order_number ?? row.id);
}

/**
 * POST /api/documents/[table]/[id]/email
 * Send any supported document via email with custom subject/body and optional PDF.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { table: string; id: string } }
) {
  try {
    const table = params.table as DocumentTable;
    const documentId = params.id;

    if (!VALID_TABLES.includes(table)) {
      return NextResponse.json({ error: 'Invalid document type' }, { status: 400 });
    }

    const businessId = getSessionScopedBusinessId(request);
    if (!businessId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const {
      to,
      cc,
      bcc,
      subject,
      body_html,
      body_text,
      attach_pdf = true,
    } = body as {
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      body_html?: string;
      body_text?: string;
      attach_pdf?: boolean;
    };

    if (!to?.trim() || !to.includes('@')) {
      return NextResponse.json({ error: 'Valid recipient email (to) is required' }, { status: 400 });
    }
    if (!subject?.trim()) {
      return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
    }
    if (!body_html?.trim() && !body_text?.trim()) {
      return NextResponse.json({ error: 'Email body is required' }, { status: 400 });
    }

    const partyJoin =
      table === 'purchase_orders'
        ? `LEFT JOIN suppliers p ON doc.supplier_id = p.id`
        : `LEFT JOIN customers p ON doc.customer_id = p.id`;

    const doc = await db.queryOne<Record<string, unknown>>(
      `SELECT doc.*, p.name as party_name, p.email as party_email
       FROM ${table} doc
       ${partyJoin}
       WHERE doc.id = $1 AND doc.business_id = $2`,
      [documentId, businessId]
    );

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const { resource, action } = authorizeResourceForTable(table);
    try {
      await authorize(userId, resource, action, {
        businessId,
        resourceId: documentId,
        branchId: (doc.branch_id as string) ?? undefined,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    if (table === 'invoices') {
      try {
        await assertFeatureAccess(businessId, FeatureKeys.EMAIL_INVOICING);
      } catch (error) {
        if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
        throw error;
      }
    }

    const docNumber = documentNumberFromRow(table, doc);
    let attachments: { filename: string; content: Buffer; contentType?: string }[] | undefined;

    if (attach_pdf) {
      try {
        const pdfBuffer = await generateDocumentPdf(documentId, table);
        if (!pdfBuffer?.length) {
          return NextResponse.json({ error: 'Generated PDF is empty' }, { status: 500 });
        }
        attachments = [
          {
            filename: pdfFilenameForDocument(table, docNumber),
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ];
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json(
          { error: msg || 'Failed to generate PDF attachment' },
          { status: 500 }
        );
      }
    }

    let htmlOut = body_html?.trim() || `<pre>${body_text}</pre>`;
    let textOut = body_text?.trim();

    if (table === 'invoices' && String(doc.status) === 'final') {
      try {
        const { ensureInvoicePublicToken, publicInvoiceUrl } = await import('@/lib/customer-surface');
        const token = await ensureInvoicePublicToken(documentId);
        const viewUrl = publicInvoiceUrl(token);
        htmlOut += `<p style="margin-top:16px;"><a href="${viewUrl}">View bill online</a></p>`;
        textOut = `${textOut || ''}\n\nView online: ${viewUrl}`.trim();
      } catch {
        // non-fatal
      }
    }

    const sent = await sendBusinessEmail(businessId, {
      to: to.trim(),
      cc: cc?.trim() || undefined,
      bcc: bcc?.trim() || undefined,
      subject: subject.trim(),
      html: htmlOut,
      text: textOut,
      attachments,
    });

    if (!sent.success) {
      return NextResponse.json(
        {
          error: sent.error || businessEmailNotConfiguredMessage(),
          code: 'EMAIL_NOT_CONFIGURED',
        },
        { status: sent.error?.includes('not configured') ? 400 : 500 }
      );
    }

    if (table === 'purchase_orders') {
      const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
      const userId = getUserIdFromRequest(request);
      await logActivity({
        business_id: businessId,
        user_id: userId || undefined,
        action_type: 'email',
        module: 'purchase_orders',
        entity_id: documentId,
        entity_type: 'purchase_order',
        description: `Purchase Order emailed to ${to.trim()}`,
        ip_address: getClientIP(request),
        user_agent: getUserAgent(request),
        metadata: { to: to.trim(), order_number: docNumber },
      });
    }

    return NextResponse.json({ success: true, message: 'Email sent successfully' });
  } catch (error: unknown) {
    console.error('Document email error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to send email';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
