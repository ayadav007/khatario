import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import {
  CustomerLinkError,
  ensureVendorCustomerLink,
  previewVendorCustomerLink,
  type CustomerLinkChoice,
} from '@/lib/supplier-hub-links';
import type { SupplierConnectionRequest } from '@/types/database';

export const dynamic = 'force-dynamic';

function readCustomerChoice(body: { customer_decision?: { choice?: string; customer_id?: string } }): CustomerLinkChoice | null {
  const raw = body.customer_decision;
  if (!raw || typeof raw !== 'object') return null;
  if (raw.choice === 'create') return { choice: 'create' };
  if (raw.choice === 'link' && typeof raw.customer_id === 'string' && raw.customer_id.trim()) {
    return { choice: 'link', customerId: raw.customer_id.trim() };
  }
  return null;
}

/**
 * GET /api/suppliers/hub/connection-requests/[id]
 * Supplier only, while the request is pending. Returns the buyer and any unlinked customers
 * who share their GSTIN, phone, or email, so Accept can ask before attaching one.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthenticatedTenant(request);
    if (auth instanceof NextResponse) return auth;
    const { businessId, userId } = auth;
    try {
      await authorize(userId, 'purchases', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const row = await db.queryOne<SupplierConnectionRequest>(
      `SELECT * FROM supplier_connection_requests WHERE id = $1`,
      [params.id]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (row.supplier_business_id !== businessId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (row.status !== 'pending') {
      return NextResponse.json({ error: 'Request is no longer pending' }, { status: 400 });
    }

    const preview = await previewVendorCustomerLink(row.supplier_business_id, row.buyer_business_id);
    return NextResponse.json(preview);
  } catch (e: unknown) {
    if (e instanceof CustomerLinkError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('hub connection-requests GET', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

/**
 * PATCH /api/suppliers/hub/connection-requests/[id]
 * Body: { action: 'accept' | 'decline' | 'cancel', customer_decision? }.
 * Business and user come from the session only.
 * accept/decline: supplier business only; cancel: buyer only (pending).
 * Accept with no customer already linked requires customer_decision:
 * { choice: 'link', customer_id } or { choice: 'create' }.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = requireAuthenticatedTenant(request);
    if (auth instanceof NextResponse) return auth;
    const { businessId, userId: updatedByUserId } = auth;
    const body = await request.json();
    const { action } = body;
    const customerChoice = readCustomerChoice(body);
    if (body.customer_decision != null && !customerChoice) {
      return NextResponse.json({ error: 'Invalid customer choice' }, { status: 400 });
    }
    const id = params.id;
    if (!['accept', 'decline', 'cancel'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const row = await db.queryOne<SupplierConnectionRequest>(
      `SELECT * FROM supplier_connection_requests WHERE id = $1`,
      [id]
    );
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (row.status !== 'pending') {
      return NextResponse.json({ error: 'Request is no longer pending' }, { status: 400 });
    }

    if (action === 'cancel') {
      if (row.buyer_business_id !== businessId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      try {
        await authorize(updatedByUserId, 'purchases', 'update', { businessId });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }
      await db.query(
        `
        UPDATE supplier_connection_requests
        SET status = 'cancelled', resolved_at = CURRENT_TIMESTAMP, resolved_by_user_id = $2
        WHERE id = $1
        `,
        [id, updatedByUserId]
      );
      // A supplier added with a link waits as 'pending' on this request; withdrawing ends it.
      await db.query(
        `UPDATE suppliers SET approval_status = 'disconnected', allow_low_stock_access = false,
                disconnected_at = CURRENT_TIMESTAMP, disconnected_by_business_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE business_id = $1 AND linked_business_id = $2 AND approval_status = 'pending' AND deleted_at IS NULL`,
        [row.buyer_business_id, row.supplier_business_id]
      );
      return NextResponse.json({ ok: true });
    }

    if (row.supplier_business_id !== businessId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      await authorize(updatedByUserId, 'purchases', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (action === 'decline') {
      await db.query(
        `
        UPDATE supplier_connection_requests
        SET status = 'declined', resolved_at = CURRENT_TIMESTAMP, resolved_by_user_id = $2
        WHERE id = $1
        `,
        [id, updatedByUserId]
      );
      await db.query(
        `UPDATE suppliers SET approval_status = 'rejected', allow_low_stock_access = false,
                rejected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE business_id = $1 AND linked_business_id = $2 AND approval_status = 'pending' AND deleted_at IS NULL`,
        [row.buyer_business_id, row.supplier_business_id]
      );
      const supName = await db.queryOne<{ name: string }>(
        `SELECT name FROM businesses WHERE id = $1`,
        [row.supplier_business_id]
      );
      await db.query(
        `
        INSERT INTO notifications (
          business_id, type, title, message, reference_type, reference_id, created_at
        )
        VALUES ($1, 'hub_connection_declined', $2, $3, 'supplier_connection_request', $4, CURRENT_TIMESTAMP)
        `,
        [
          row.buyer_business_id,
          'Connection request declined',
          `${supName?.name || 'The supplier'} declined your connection request.`,
          id,
        ]
      );
      return NextResponse.json({ ok: true });
    }

    // accept — ask before attaching an existing customer or creating one
    const preview = await previewVendorCustomerLink(row.supplier_business_id, row.buyer_business_id);
    if (!preview.already_linked && !customerChoice) {
      return NextResponse.json(
        {
          error: 'Choose an existing customer or create a new one',
          code: 'CUSTOMER_DECISION_REQUIRED',
          buyer: preview.buyer,
          matches: preview.matches,
        },
        { status: 409 }
      );
    }

    const peer = await db.queryOne<{
      name: string;
      phone: string | null;
      email: string | null;
      city: string | null;
      state: string | null;
      gstin: string | null;
    }>(
      `SELECT name, phone, email, city, state, gstin FROM businesses WHERE id = $1`,
      [row.supplier_business_id]
    );
    if (!peer) {
      return NextResponse.json({ error: 'Supplier business not found' }, { status: 400 });
    }

    const existing = await db.queryOne<{ id: string }>(
      `SELECT id FROM suppliers WHERE business_id = $1 AND linked_business_id = $2`,
      [row.buyer_business_id, row.supplier_business_id]
    );
    // The buyer chose this when sending the request; it never comes from the supplier's call.
    const shareLowStock = row.share_low_stock === true;

    if (existing) {
      await db.query(
        `
        UPDATE suppliers SET
          approval_status = 'approved',
          approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP),
          disconnected_at = NULL,
          disconnected_by_business_id = NULL,
          rejected_at = NULL,
          rejection_reason = NULL,
          linked_business_id = $2,
          is_active = true,
          name = CASE WHEN TRIM(COALESCE(name, '')) = '' THEN $3 ELSE name END,
          phone = COALESCE(phone, $4),
          email = COALESCE(email, $5),
          city = COALESCE(city, $6),
          state = COALESCE(state, $7),
          gstin = COALESCE(gstin, $8),
          allow_low_stock_access = (allow_low_stock_access OR $9),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [
          existing.id,
          row.supplier_business_id,
          peer.name,
          peer.phone,
          peer.email,
          peer.city,
          peer.state,
          peer.gstin,
          shareLowStock,
        ]
      );
    } else {
      await db.query(
        `
        INSERT INTO suppliers (
          business_id, name, phone, email, city, state, gstin,
          opening_balance, opening_balance_type,
          linked_business_id, requested_by_business_id, approval_status, approved_at,
          allow_low_stock_access
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'credit', $8, $9, 'approved', CURRENT_TIMESTAMP, $10)
        `,
        [
          row.buyer_business_id,
          peer.name,
          peer.phone,
          peer.email,
          peer.city,
          peer.state,
          peer.gstin,
          row.supplier_business_id,
          row.buyer_business_id,
          shareLowStock,
        ]
      );
    }

    await ensureVendorCustomerLink(
      row.supplier_business_id,
      row.buyer_business_id,
      undefined,
      preview.already_linked ? undefined : customerChoice || undefined
    );

    await db.query(
      `
      UPDATE supplier_connection_requests
      SET status = 'accepted', resolved_at = CURRENT_TIMESTAMP, resolved_by_user_id = $2
      WHERE id = $1
      `,
      [id, updatedByUserId]
    );

    await db.query(
      `
      INSERT INTO notifications (
        business_id, type, title, message, reference_type, reference_id, created_at
      )
      VALUES ($1, 'hub_connection_accepted', $2, $3, 'supplier_connection_request', $4, CURRENT_TIMESTAMP)
      `,
      [
        row.buyer_business_id,
        'Supplier connection accepted',
        shareLowStock
          ? `${peer.name} accepted your connection request. They will see when their items reach your reorder level and can propose orders for you to confirm.`
          : `${peer.name} accepted your connection request. Their bills now come into Supplier Hub, and you can order from them there.`,
        id,
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e instanceof CustomerLinkError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('hub connection-requests PATCH', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
