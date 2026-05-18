import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import type { SupplierConnectionRequest } from '@/types/database';

/**
 * PATCH /api/suppliers/hub/connection-requests/[id]
 * Body: { action: 'accept' | 'decline' | 'cancel', updated_by_user_id }
 * accept/decline: supplier business only; cancel: buyer only (pending).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const businessId = getBusinessIdFromRequest(request, body);
    const userId = getUserIdFromRequest(request, body);
    const { action, updated_by_user_id: updatedByUserId } = body;
    const id = params.id;

    if (!businessId || !id) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    if (!updatedByUserId) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }
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

    // accept
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

    if (existing) {
      await db.query(
        `
        UPDATE suppliers SET
          approval_status = 'approved',
          approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP),
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'credit', $8, $9, 'approved', CURRENT_TIMESTAMP, false)
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
        ]
      );
    }

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
        `${peer.name} accepted your connection request. You can add purchases and requests under Suppliers.`,
        id,
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('hub connection-requests PATCH', e);
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}
