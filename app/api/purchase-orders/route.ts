import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { FeatureKeys } from '@/lib/featureKeys';
import { getBusinessIdFromRequest, getAuthenticatedUserId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { partiesFromItemOwner, purchaseQtyAllowed } from '@/lib/quantity-request-parties';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/purchase-orders
 * Fetch all purchase orders for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const status = searchParams.get('status');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const pool = getPool();
    let query = `
      SELECT 
        po.*,
        s.name as supplier_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.business_id = $1
    `;

    const params: any[] = [businessId];

    if (status) {
      query += ` AND po.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY po.order_date DESC, po.created_at DESC`;

    const result = await pool.query(query, params);

    return NextResponse.json({ purchaseOrders: result.rows });
  } catch (error: any) {
    console.error('Error fetching purchase orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch purchase orders', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/purchase-orders
 * Create a new purchase order
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const body = await request.json();
    const {
      business_id,
      supplier_id,
      order_number,
      order_date,
      expected_delivery_date,
      items,
      subtotal = 0,
      discount_total = 0,
      tax_total = 0,
      round_off = 0,
      grand_total = 0,
      additional_charges = 0,
      additional_charges_label,
      shipping_address,
      billing_address,
      place_of_supply_state_code,
      notes,
      terms,
      created_by,
      status = 'draft',
      request_id,
    } = body;

    if (!business_id || !supplier_id || !order_number || !order_date || !items || items.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: 'business_id, supplier_id, order_number, order_date, and items are required' },
        { status: 400 }
      );
    }

    const sessionBusinessId = getBusinessIdFromRequest(request, body);
    if (sessionBusinessId && String(sessionBusinessId) !== String(business_id)) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: 'business_id does not match authenticated session', code: 'TENANT_MISMATCH' },
        { status: 403 }
      );
    }

    let linkedRequest: {
      buyerBusinessId: string;
      vendorBusinessId: string;
    } | null = null;

    if (request_id) {
      const qrRes = await client.query(
        `SELECT qr.id, qr.requester_business_id, qr.responder_business_id, qr.item_id,
                qr.status, qr.requested_qty, qr.confirmed_qty, qr.purchase_order_id,
                i.business_id AS item_business_id
         FROM quantity_requests qr
         JOIN items i ON i.id = qr.item_id
         WHERE qr.id = $1`,
        [request_id]
      );
      if (qrRes.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json({ error: 'quantity request not found', code: 'REQUEST_NOT_FOUND' }, { status: 400 });
      }
      const qr = qrRes.rows[0];
      if (qr.purchase_order_id) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json(
          { error: 'This quantity request is already linked to a purchase order', code: 'PO_ALREADY_LINKED' },
          { status: 409 }
        );
      }
      const parties = partiesFromItemOwner(
        qr.requester_business_id,
        qr.responder_business_id,
        qr.item_business_id,
        qr.item_id
      );
      if (!parties) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json(
          { error: 'Quantity request is not tied to the buyer catalog item', code: 'ITEM_NOT_BUYER' },
          { status: 400 }
        );
      }
      if (String(parties.buyerBusinessId) !== String(business_id)) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json(
          { error: 'The purchase order must be created on the buyer’s books' },
          { status: 403 }
        );
      }
      const allowedQty = purchaseQtyAllowed(
        String(qr.status),
        Number(qr.requested_qty),
        qr.confirmed_qty == null ? null : Number(qr.confirmed_qty)
      );
      if (allowedQty == null) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json(
          {
            error: 'Confirm the quantity before creating a purchase order',
            code: 'REQUEST_NOT_CONFIRMED',
          },
          { status: 409 }
        );
      }
      const supplierOk = await client.query(
        `SELECT id FROM suppliers
         WHERE id = $1 AND business_id = $2 AND linked_business_id = $3 AND deleted_at IS NULL`,
        [supplier_id, parties.buyerBusinessId, parties.vendorBusinessId]
      );
      if (supplierOk.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json(
          {
            error: 'Supplier must be the linked vendor on this quantity request',
            code: 'SUPPLIER_NOT_ON_REQUEST',
          },
          { status: 400 }
        );
      }
      let lineQty = 0;
      for (let j = 0; j < items.length; j++) {
        const line = items[j];
        const lid = line.item_id || line.itemId;
        if (!lid || String(lid) !== String(parties.buyerItemId)) {
          await client.query('ROLLBACK');
          client.release();
          return NextResponse.json(
            {
              error: 'Purchase order lines must use the buyer’s item from this quantity request.',
              code: 'ITEM_NOT_BUYER_LINE',
            },
            { status: 400 }
          );
        }
        lineQty += Number(line.qty || line.quantity || 0);
      }
      if (!(lineQty > 0) || lineQty - allowedQty > 1e-6) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json(
          {
            error: 'Purchase order quantity cannot exceed the confirmed quantity',
            code: 'QTY_EXCEEDS_CONFIRMED',
          },
          { status: 400 }
        );
      }
      linkedRequest = parties;
    }

    const actorUserId = getAuthenticatedUserId(request);
    if (!actorUserId) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json({ error: 'created_by is required' }, { status: 400 });
    }
    try {
      await enforceAccess({
        businessId: business_id,
        userId: actorUserId,
        feature: FeatureKeys.PURCHASE_MANAGEMENT,
        limitType: 'purchase_orders',
        poolClient: client,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    // Create purchase order
    const orderResult = await client.query(`
      INSERT INTO purchase_orders (
        business_id, supplier_id, order_number, order_date, expected_delivery_date,
        status, subtotal, discount_total, tax_total, round_off, grand_total,
        additional_charges, additional_charges_label, shipping_address, billing_address,
        place_of_supply_state_code, notes, terms, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      business_id, supplier_id, order_number, order_date, expected_delivery_date,
      status, subtotal, discount_total, tax_total, round_off, grand_total,
      additional_charges, additional_charges_label || null, shipping_address || null, billing_address || null,
      place_of_supply_state_code || null, notes || null, terms || null, actorUserId
    ]);

    const purchaseOrder = orderResult.rows[0];

    // Create purchase order items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await client.query(`
        INSERT INTO purchase_order_items (
          purchase_order_id, item_id, item_name, description, hsn_sac, qty, unit, unit_price,
          discount_percent, discount_amount, tax_rate, tax_amount, taxable_value,
          cgst_amount, sgst_amount, igst_amount, line_total, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [
        purchaseOrder.id, item.item_id || null, item.item_name || item.name, item.description || null,
        item.hsn_sac || null, item.qty || item.quantity, item.unit || 'PCS', item.unit_price || item.price,
        item.discount_percent || 0, item.discount_amount || 0, item.tax_rate || item.taxPercent || 0,
        item.tax_amount || 0, item.taxable_value || 0,
        item.cgst_amount || 0, item.sgst_amount || 0, item.igst_amount || 0,
        item.line_total || item.total || 0, i
      ]);
    }

    // Link to quantity request if provided
    if (request_id) {
      await client.query(`
        UPDATE quantity_requests
        SET purchase_order_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [purchaseOrder.id, request_id]);

      // Notify supplier (responder) about the purchase order
      const requestRes = await client.query(`
        SELECT requester_business_id, responder_business_id, item_id
        FROM quantity_requests
        WHERE id = $1
      `, [request_id]);

      if (requestRes.rows.length > 0 && linkedRequest) {
        const customerBiz = await client.query(`SELECT name FROM businesses WHERE id = $1`, [business_id]);
        const customerName = customerBiz.rows[0]?.name || 'Customer';

        try {
          await client.query(`
            INSERT INTO notifications (
              business_id, type, title, message, reference_type, reference_id, created_at
            )
            VALUES ($1, 'quantity_request', $2, $3, 'purchase_order', $4, CURRENT_TIMESTAMP)
          `, [
            linkedRequest.vendorBusinessId,
            'Purchase Order Created',
            `${customerName} created Purchase Order ${order_number} for your quantity request.`,
            purchaseOrder.id
          ]);
        } catch (notifError: any) {
          // Log notification error but don't fail the purchase order creation
          console.error('Error creating notification (non-fatal):', notifError.message);
        }
      }
    }

    await client.query('COMMIT');

    const grandTotal = Number(purchaseOrder.grand_total ?? 0);
    const formattedTotal = `₹${grandTotal.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    await logActivity({
      business_id: business_id,
      user_id: actorUserId,
      action_type: 'create',
      module: 'purchase_orders',
      entity_id: purchaseOrder.id,
      entity_type: 'purchase_order',
      description: `Purchase Order created for ${formattedTotal}`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: {
        order_number,
        status,
        grand_total: grandTotal,
      },
    });

    return NextResponse.json({ purchaseOrder }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating purchase order:', error);
    return NextResponse.json(
      { error: 'Failed to create purchase order', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

