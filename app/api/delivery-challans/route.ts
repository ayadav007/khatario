import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/**
 * GET /api/delivery-challans
 * Fetch all delivery challans for a business
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
        dc.*,
        c.name as customer_name,
        i.invoice_number,
        so.order_number as sales_order_number
      FROM delivery_challans dc
      LEFT JOIN customers c ON dc.customer_id = c.id
      LEFT JOIN invoices i ON dc.invoice_id = i.id
      LEFT JOIN sales_orders so ON dc.sales_order_id = so.id
      WHERE dc.business_id = $1
    `;

    const params: any[] = [businessId];

    if (status) {
      query += ` AND dc.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY dc.challan_date DESC, dc.created_at DESC`;

    const result = await pool.query(query, params);

    return NextResponse.json({ deliveryChallans: result.rows });
  } catch (error: any) {
    console.error('Error fetching delivery challans:', error);
    return NextResponse.json(
      { error: 'Failed to fetch delivery challans', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/delivery-challans
 * Create a new delivery challan
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const body = await request.json();
    const {
      business_id,
      customer_id,
      invoice_id,
      sales_order_id,
      challan_number,
      challan_date,
      delivery_date,
      e_way_bill_number,
      vehicle_number,
      transporter_name,
      transporter_gstin,
      shipping_address,
      billing_address,
      place_of_delivery,
      dispatch_from_address,
      reason_for_transportation, // NEW
      items,
      notes,
      terms,
      created_by,
    } = body;

    if (!business_id || !challan_number || !challan_date || !items || items.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'business_id, challan_number, challan_date, and items are required' },
        { status: 400 }
      );
    }

    // Create delivery challan
    const challanResult = await client.query(`
      INSERT INTO delivery_challans (
        business_id, customer_id, invoice_id, sales_order_id, challan_number, challan_date, delivery_date,
        e_way_bill_number, vehicle_number, transporter_name, transporter_gstin,
        shipping_address, billing_address, place_of_delivery, dispatch_from_address,
        reason_for_transportation, notes, terms, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      business_id,
      customer_id || null,
      invoice_id || null,
      sales_order_id || null,
      challan_number,
      challan_date,
      delivery_date || null,
      e_way_bill_number || null,
      vehicle_number || null,
      transporter_name || null,
      transporter_gstin || null,
      shipping_address || null,
      billing_address || null,
      place_of_delivery || null,
      dispatch_from_address || null,
      reason_for_transportation || null, // NEW
      notes || null,
      terms || null,
      created_by || null
    ]);

    const deliveryChallan = challanResult.rows[0];

    // Create delivery challan items (no stock movement - challan is non-taxable shipping doc)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await client.query(`
        INSERT INTO delivery_challan_items (
          delivery_challan_id, item_id, item_name, description, hsn_sac, qty, unit, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        deliveryChallan.id,
        item.item_id || null,
        item.item_name || item.name || item.description,
        item.description || null,
        item.hsn_sac || null,
        item.qty || item.quantity,
        item.unit || 'PCS',
        i
      ]);
    }

    await client.query('COMMIT');

    return NextResponse.json({ deliveryChallan }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating delivery challan:', error);
    return NextResponse.json(
      { error: 'Failed to create delivery challan', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

