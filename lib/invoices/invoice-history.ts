/**
 * Reads one invoice's History: revisions from invoice_revisions (migration 469), newest first,
 * each compared with the revision before it, then activity_logs rows written before history
 * started.
 */
import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import type { InvoiceSnapshot } from '@/types/database';
import {
  describeRevision,
  diffInvoiceSnapshots,
  INVOICE_ACTION_LABELS,
  type InvoiceDiff,
} from '@/lib/invoices/invoice-revision-diff';

export interface InvoiceHistoryEntry {
  id: string;
  kind: 'revision' | 'activity';
  revision_no: number | null;
  action: string;
  /** Same as `action`; kept for clients that read the older activity-log shape. */
  action_type: string;
  action_label: string;
  description: string;
  reason: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  diff: InvoiceDiff | null;
}

interface RevisionRow {
  id: string;
  revision_no: number;
  action: string;
  reason: string | null;
  actor_name: string | null;
  snapshot: InvoiceSnapshot;
  created_at: string;
}

function actionLabel(action: string): string {
  return INVOICE_ACTION_LABELS[action] ?? action;
}

export async function loadInvoiceHistory(
  businessId: string,
  invoiceId: string,
  limit: number,
): Promise<InvoiceHistoryEntry[]> {
  // One extra row so the oldest revision shown can still be compared with its predecessor.
  const rows = await queryRows<RevisionRow>(
    `SELECT id, revision_no, action, reason, actor_name, snapshot, created_at
       FROM invoice_revisions
      WHERE business_id = $1 AND invoice_id = $2
      ORDER BY revision_no DESC
      LIMIT $3`,
    [businessId, invoiceId, limit + 1],
  );

  const entries: InvoiceHistoryEntry[] = [];
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const row = rows[i];
    const prev = rows[i + 1]?.revision_no === row.revision_no - 1 ? rows[i + 1].snapshot : null;
    const diff = diffInvoiceSnapshots(prev, row.snapshot);
    const invoiceNumber = String(row.snapshot?.header?.invoice_number ?? '');
    entries.push({
      id: row.id,
      kind: 'revision',
      revision_no: row.revision_no,
      action: row.action,
      action_type: row.action,
      action_label: actionLabel(row.action),
      description: describeRevision(row.action, diff, invoiceNumber),
      reason: row.reason,
      created_at: row.created_at,
      user_name: row.actor_name,
      user_email: null,
      diff,
    });
  }

  const remaining = limit - entries.length;
  if (remaining <= 0) return entries;

  // Older activity only when the whole revision list is on screen.
  const first = await queryOne<{ created_at: string | null }>(
    `SELECT MIN(created_at) AS created_at FROM invoice_revisions WHERE business_id = $1 AND invoice_id = $2`,
    [businessId, invoiceId],
  );
  const legacy = await queryRows<{
    id: string;
    action_type: string;
    description: string;
    created_at: string;
    user_name: string | null;
    user_email: string | null;
  }>(
    `SELECT al.id, al.action_type, al.description, al.created_at, u.name AS user_name, u.email AS user_email
       FROM activity_logs al
       LEFT JOIN users u ON u.id = al.user_id
      WHERE al.business_id = $1
        AND al.module = 'invoices'
        AND al.entity_id = $2
        AND ($3::timestamptz IS NULL OR al.created_at < $3::timestamptz)
      ORDER BY al.created_at DESC
      LIMIT $4`,
    [businessId, invoiceId, first?.created_at ?? null, remaining],
  );
  for (const row of legacy) {
    entries.push({
      id: row.id,
      kind: 'activity',
      revision_no: null,
      action: row.action_type,
      action_type: row.action_type,
      action_label: actionLabel(row.action_type),
      description: row.description,
      reason: null,
      created_at: row.created_at,
      user_name: row.user_name,
      user_email: row.user_email,
      diff: null,
    });
  }
  return entries;
}

export interface InvoiceRevisionDetail {
  revision_no: number;
  action: string;
  action_label: string;
  reason: string | null;
  created_at: string;
  user_name: string | null;
  snapshot: InvoiceSnapshot;
}

export async function loadInvoiceRevision(
  businessId: string,
  invoiceId: string,
  revisionNo: number,
): Promise<InvoiceRevisionDetail | null> {
  const row = await queryOne<RevisionRow>(
    `SELECT id, revision_no, action, reason, actor_name, snapshot, created_at
       FROM invoice_revisions
      WHERE business_id = $1 AND invoice_id = $2 AND revision_no = $3`,
    [businessId, invoiceId, revisionNo],
  );
  if (!row) return null;
  return {
    revision_no: row.revision_no,
    action: row.action,
    action_label: actionLabel(row.action),
    reason: row.reason,
    created_at: row.created_at,
    user_name: row.actor_name,
    snapshot: row.snapshot,
  };
}

/**
 * Session business and user, the invoice in that business, and read permission on it.
 * Returns the business id, or the response to send back.
 */
export async function authorizeInvoiceHistory(
  request: NextRequest,
  invoiceId: string,
): Promise<{ businessId: string } | NextResponse> {
  const userId = getUserIdFromRequest(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const invoice = await queryOne<{ branch_id: string | null }>(
    'SELECT branch_id FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
    [invoiceId, businessId],
  );
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  try {
    await authorize(userId, 'invoices', 'read', {
      businessId,
      branchId: invoice.branch_id ?? undefined,
      resourceId: invoiceId,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }
  return { businessId };
}
