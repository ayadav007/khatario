import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { isRecurringFrequency } from '@/lib/invoices/recurring-schedule';

export const dynamic = 'force-dynamic';

/**
 * GET /api/recurring-invoices
 * Fetch all recurring invoices for a business
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) {
      return tenant.response;
    }
    const businessId = tenant.businessId;

    const recurringInvoices = await db.queryRows(`
      SELECT 
        ri.*,
        ri.start_date::text AS start_date, ri.end_date::text AS end_date,
        ri.next_run_date::text AS next_run_date, ri.last_run_date::text AS last_run_date,
        c.name as customer_name,
        ti.invoice_number AS template_invoice_number,
        (SELECT COUNT(*) FROM recurring_invoice_history h
          WHERE h.recurring_invoice_id = ri.id AND h.status = 'success')::int AS invoices_raised
      FROM recurring_invoices ri
      LEFT JOIN customers c ON ri.customer_id = c.id
      LEFT JOIN invoices ti ON ti.id = ri.template_invoice_id
      WHERE ri.business_id = $1
      ORDER BY ri.created_at DESC
    `, [businessId]);

    return NextResponse.json({ recurringInvoices });
  } catch (error: any) {
    console.error('Error fetching recurring invoices:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recurring invoices', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/recurring-invoices
 * Create a new recurring invoice. Lines come from `items` or, when empty, from `template_invoice_id`.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) {
      return tenant.response;
    }
    const business_id = tenant.businessId;
    const {
      customer_id,
      template_invoice_id,
      invoice_prefix,
      frequency,
      interval_value = 1,
      start_date,
      end_date,
      notes,
      terms,
      auto_finalize,
      branch_id,
    } = body;
    const items = Array.isArray(body.items) ? body.items : [];

    if (!customer_id || !frequency || !start_date) {
      return NextResponse.json(
        { error: 'customer_id, frequency and start_date are required' },
        { status: 400 }
      );
    }
    if (!isRecurringFrequency(frequency)) {
      return NextResponse.json({ error: 'Invalid frequency' }, { status: 400 });
    }
    const interval = Number(interval_value);
    if (!Number.isInteger(interval) || interval < 1 || interval > 36) {
      return NextResponse.json({ error: 'interval_value must be a whole number between 1 and 36' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start_date)) || (end_date && String(end_date) < String(start_date))) {
      return NextResponse.json({ error: 'start_date must be YYYY-MM-DD and end_date on or after it' }, { status: 400 });
    }
    if (items.length === 0 && !template_invoice_id) {
      return NextResponse.json({ error: 'Provide items or a template invoice' }, { status: 400 });
    }

    try {
      await authorize(userId, 'invoices', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    try {
      await assertFeatureAccess(business_id, FeatureKeys.RECURRING_INVOICES);
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const customer = await db.queryOne(
      `SELECT id FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [customer_id, business_id]
    );
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    if (template_invoice_id) {
      const tpl = await db.queryOne(
        `SELECT id FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [template_invoice_id, business_id]
      );
      if (!tpl) return NextResponse.json({ error: 'Template invoice not found' }, { status: 404 });
    }

    const recurringInvoice = await db.queryOne(`
      INSERT INTO recurring_invoices (
        business_id, customer_id, template_invoice_id, invoice_prefix,
        frequency, interval_value, start_date, end_date, next_run_date,
        items, notes, terms, created_by, auto_finalize, branch_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $9::jsonb, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      business_id, customer_id, template_invoice_id || null, invoice_prefix || null,
      frequency, interval, start_date, end_date || null,
      JSON.stringify(items), notes || null, terms || null, userId, auto_finalize === true, branch_id || null,
    ]);

    return NextResponse.json({ recurringInvoice }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating recurring invoice:', error);
    return NextResponse.json(
      { error: 'Failed to create recurring invoice', details: error.message },
      { status: 500 }
    );
  }
}
