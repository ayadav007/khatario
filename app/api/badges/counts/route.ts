import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'Business ID is required' },
        { status: 400 }
      );
    }

    // 1. Outstanding receivables (matches Invoices list "Unpaid" filter: finalized tax/credit docs only).
    // Do not count drafts (they are typically payment_status = unpaid) or proforma estimates.
    const unpaidInvoicesRes = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count 
       FROM invoices 
       WHERE business_id = $1 
         AND status = 'final'
         AND payment_status IN ('unpaid', 'partially_paid')
         AND (document_type IS NULL OR document_type != 'proforma_invoice')`,
      [businessId]
    );

    // 2. Low Stock Items Count
    const lowStockItemsRes = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count 
       FROM items 
       WHERE business_id = $1 AND current_stock <= min_stock AND is_active = true`,
      [businessId]
    );

    return NextResponse.json({
      unpaid_invoices: Number(unpaidInvoicesRes?.count || 0),
      low_stock_items: Number(lowStockItemsRes?.count || 0)
    });

  } catch (error: any) {
    console.error('Badge counts error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

