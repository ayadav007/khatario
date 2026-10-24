import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import type { DocumentTable } from '@/lib/pdf-generator';

export const DOCUMENT_TABLES: DocumentTable[] = [
  'invoices',
  'sales_orders',
  'delivery_challans',
  'credit_notes',
  'debit_notes',
  'purchase_orders',
  'work_orders',
];

/** RBAC module per table; tables without a module rely on tenant scoping, matching their list routes. */
const READ_MODULE: Partial<Record<DocumentTable, string>> = {
  invoices: 'invoices',
  sales_orders: 'sales_orders',
  credit_notes: 'credit_notes',
  debit_notes: 'debit_notes',
  work_orders: 'work_orders',
};

export type DocumentAccessResult =
  | { ok: true; table: DocumentTable; businessId: string; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Validates the table name and confirms the document belongs to the session's business
 * before any document data is loaded by id.
 */
export async function requireDocumentReadAccess(
  request: NextRequest,
  table: string,
  id: string
): Promise<DocumentAccessResult> {
  if (!DOCUMENT_TABLES.includes(table as DocumentTable)) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid document type' }, { status: 400 }) };
  }
  const docTable = table as DocumentTable;

  const businessId = getSessionScopedBusinessId(request);
  const userId = getUserIdFromRequest(request);
  if (!businessId || !userId) {
    return { ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  }

  const row = await queryOne<{ id: string; branch_id?: string | null }>(
    `SELECT * FROM ${docTable} WHERE id = $1 AND business_id = $2`,
    [id, businessId]
  );
  if (!row) {
    return { ok: false, response: NextResponse.json({ error: 'Document not found' }, { status: 404 }) };
  }

  const moduleKey = READ_MODULE[docTable];
  if (moduleKey) {
    try {
      await authorize(userId, moduleKey, 'read', {
        businessId,
        branchId: row.branch_id ?? undefined,
        resourceId: id,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return { ok: false, response: error.toNextResponse() };
      }
      throw error;
    }
  }

  return { ok: true, table: docTable, businessId, userId };
}
