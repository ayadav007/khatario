import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';

/**
 * GET /api/search?q=query&business_id=xxx
 * Global search across invoices, customers, items, suppliers
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const businessId = searchParams.get('business_id');

    if (!query || !businessId) {
      return NextResponse.json({ results: [] });
    }

    const searchTerm = `%${query.trim()}%`;

    // Search invoices
    const invoices = await db.queryRows(`
      SELECT 
        'invoice' as type,
        id,
        invoice_number as title,
        invoice_number as subtitle,
        invoice_date as date,
        grand_total as amount
      FROM invoices
      WHERE business_id = $1
        AND deleted_at IS NULL
        AND (invoice_number ILIKE $2 OR notes ILIKE $2)
        AND status != 'cancelled'
      ORDER BY invoice_date DESC
      LIMIT 10
    `, [businessId, searchTerm]);

    // Search customers
    const customers = await db.queryRows(`
      SELECT 
        'customer' as type,
        id,
        name as title,
        phone as subtitle,
        created_at as date,
        NULL as amount
      FROM customers
      WHERE business_id = $1
        AND deleted_at IS NULL
        AND (name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)
        AND is_active = true
      ORDER BY name ASC
      LIMIT 10
    `, [businessId, searchTerm]);

    // Search items
    const items = await db.queryRows(`
      SELECT 
        'item' as type,
        id,
        name as title,
        code as subtitle,
        created_at as date,
        selling_price as amount
      FROM items
      WHERE business_id = $1
        AND (name ILIKE $2 OR code ILIKE $2)
        AND (is_active IS NULL OR is_active = true)
      ORDER BY name ASC
      LIMIT 10
    `, [businessId, searchTerm]);

    // Search suppliers
    const suppliers = await db.queryRows(`
      SELECT 
        'supplier' as type,
        id,
        name as title,
        phone as subtitle,
        created_at as date,
        NULL as amount
      FROM suppliers
      WHERE business_id = $1
        AND (name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)
        AND is_active = true
      ORDER BY name ASC
      LIMIT 10
    `, [businessId, searchTerm]);

    // Search estimates (proforma invoices)
    const estimates = await db.queryRows(`
      SELECT 
        'estimate' as type,
        id,
        invoice_number as title,
        invoice_number as subtitle,
        invoice_date as date,
        grand_total as amount
      FROM invoices
      WHERE business_id = $1
        AND deleted_at IS NULL
        AND document_type = 'proforma_invoice'
        AND (invoice_number ILIKE $2 OR notes ILIKE $2)
        AND status != 'cancelled'
      ORDER BY invoice_date DESC
      LIMIT 10
    `, [businessId, searchTerm]);

    return NextResponse.json({
      query,
      results: {
        invoices,
        estimates,
        customers,
        items,
        suppliers
      },
      total: invoices.length + estimates.length + customers.length + items.length + suppliers.length
    });
  } catch (error: any) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Search failed', details: error.message },
      { status: 500 }
    );
  }
}
