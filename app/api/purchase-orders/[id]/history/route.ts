import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { getSessionScopedBusinessId } from '@/lib/auth-helpers';

export interface TimelineEntry {
  id: string;
  kind: 'activity' | 'comment';
  description: string;
  created_at: string;
  user_name: string | null;
  action_type?: string;
}

function formatInr(n: number | string | null | undefined) {
  const num = Number(n ?? 0);
  return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * GET /api/purchase-orders/[id]/history
 * Activity log + comments + synthesized events from PO record, conversion, and attachments.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const purchaseOrderId = params.id;
    const businessId = getSessionScopedBusinessId(request);
    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const po = await queryOne<{
      id: string;
      business_id: string;
      order_number: string;
      grand_total: string | number;
      status: string;
      created_at: string;
      updated_at: string;
      converted_purchase_id: string | null;
      created_by_name: string | null;
      bill_number: string | null;
      purchase_created_at: string | null;
    }>(
      `
      SELECT
        po.id,
        po.business_id,
        po.order_number,
        po.grand_total,
        po.status,
        po.created_at,
        po.updated_at,
        po.converted_purchase_id,
        u.name AS created_by_name,
        p.bill_number,
        p.created_at AS purchase_created_at
      FROM purchase_orders po
      LEFT JOIN users u ON u.id = po.created_by
      LEFT JOIN purchases p ON p.id = po.converted_purchase_id
      WHERE po.id = $1 AND po.business_id = $2
      `,
      [purchaseOrderId, businessId]
    );
    if (!po) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }

    const limitParam = Number(new URL(request.url).searchParams.get('limit') ?? '100');
    const limit = Math.min(Math.max(limitParam, 1), 500);

    const activities = await queryRows<{
      id: string;
      action_type: string;
      description: string;
      created_at: string;
      user_name: string | null;
    }>(
      `
      SELECT al.id, al.action_type, al.description, al.created_at, u.name AS user_name
      FROM activity_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.business_id = $1
        AND al.module = 'purchase_orders'
        AND al.entity_id = $2
      ORDER BY al.created_at DESC
      LIMIT $3
      `,
      [businessId, purchaseOrderId, limit]
    );

    const comments = await queryRows<{
      id: string;
      comment_text: string;
      created_at: string;
      user_name: string | null;
    }>(
      `
      SELECT ec.id, ec.comment_text, ec.created_at, u.name AS user_name
      FROM entity_comments ec
      LEFT JOIN users u ON u.id = ec.user_id
      WHERE ec.business_id = $1
        AND ec.entity_type = 'purchase_order'
        AND ec.entity_id = $2
      ORDER BY ec.created_at DESC
      LIMIT $3
      `,
      [businessId, purchaseOrderId, limit]
    );

    const attachments = await queryRows<{
      id: string;
      file_name: string;
      created_at: string;
      uploaded_by_name: string | null;
    }>(
      `
      SELECT da.id, da.file_name, da.created_at, u.name AS uploaded_by_name
      FROM document_attachments da
      LEFT JOIN users u ON u.id = da.uploaded_by
      WHERE da.business_id = $1
        AND da.entity_type = 'purchase_order'
        AND da.entity_id = $2
      ORDER BY da.created_at DESC
      `,
      [businessId, purchaseOrderId]
    );

    const hasLoggedCreate = activities.some((a) => a.action_type === 'create');
    const hasLoggedConvert = activities.some((a) => a.action_type === 'convert');
    const loggedAttachmentIds = new Set(
      activities
        .filter((a) => a.action_type === 'attachment')
        .map((a) => a.description)
    );

    const synthetic: TimelineEntry[] = [];

    if (!hasLoggedCreate) {
      synthetic.push({
        id: `synthetic-create-${po.id}`,
        kind: 'activity',
        description: `Purchase Order created for ${formatInr(po.grand_total)}`,
        created_at: po.created_at,
        user_name: po.created_by_name,
        action_type: 'create',
      });
    }

    if (po.converted_purchase_id && !hasLoggedConvert) {
      const billLabel = po.bill_number || 'purchase bill';
      synthetic.push({
        id: `synthetic-convert-${po.id}`,
        kind: 'activity',
        description: `Converted to purchase ${billLabel}`,
        created_at: po.purchase_created_at || po.updated_at,
        user_name: po.created_by_name,
        action_type: 'convert',
      });
    }

    for (const att of attachments) {
      const desc = `Attachment added: ${att.file_name}`;
      if (loggedAttachmentIds.has(desc)) continue;
      synthetic.push({
        id: `synthetic-attachment-${att.id}`,
        kind: 'activity',
        description: desc,
        created_at: att.created_at,
        user_name: att.uploaded_by_name,
        action_type: 'attachment',
      });
    }

    const timeline: TimelineEntry[] = [
      ...activities.map((row) => ({
        id: `activity-${row.id}`,
        kind: 'activity' as const,
        description: row.description,
        created_at: row.created_at,
        user_name: row.user_name,
        action_type: row.action_type,
      })),
      ...synthetic,
      ...comments.map((row) => ({
        id: `comment-${row.id}`,
        kind: 'comment' as const,
        description: row.comment_text,
        created_at: row.created_at,
        user_name: row.user_name,
      })),
    ];

    timeline.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return NextResponse.json({
      history: timeline.slice(0, limit),
      comment_count: comments.length,
    });
  } catch (error: unknown) {
    console.error('Error fetching purchase order history:', error);
    const msg = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
