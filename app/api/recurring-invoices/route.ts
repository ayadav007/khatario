import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';

/**
 * GET /api/recurring-invoices
 * Fetch all recurring invoices for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const recurringInvoices = await db.queryRows(`
      SELECT 
        ri.*,
        c.name as customer_name
      FROM recurring_invoices ri
      LEFT JOIN customers c ON ri.customer_id = c.id
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
 * Create a new recurring invoice
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      customer_id,
      template_invoice_id,
      invoice_prefix,
      frequency,
      interval_value = 1,
      start_date,
      end_date,
      items,
      notes,
      terms,
      created_by,
    } = body;

    if (!business_id || !customer_id || !frequency || !start_date || !items) {
      return NextResponse.json(
        { error: 'business_id, customer_id, frequency, start_date, and items are required' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(business_id, FeatureKeys.RECURRING_INVOICES);
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Calculate next_run_date based on start_date
    const nextRunDate = start_date; // First run is on start date

    const recurringInvoice = await db.queryOne(`
      INSERT INTO recurring_invoices (
        business_id, customer_id, template_invoice_id, invoice_prefix,
        frequency, interval_value, start_date, end_date, next_run_date,
        items, notes, terms, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
      RETURNING *
    `, [
      business_id, customer_id, template_invoice_id, invoice_prefix,
      frequency, interval_value, start_date, end_date, nextRunDate,
      JSON.stringify(items), notes, terms, created_by
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

