import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import {
  assertFeatureAccess,
  FeatureAccessDeniedError,
} from '@/lib/subscription/feature-access';

// POST - Generate custom report
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, entity_type, fields } = body;

    if (!business_id || !entity_type || !fields || !Array.isArray(fields)) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check feature access
    await assertFeatureAccess(business_id, 'report_builder');

    // Build query based on entity type
    let query = '';
    let tableName = '';
    let allowedFields: string[] = [];

    switch (entity_type) {
      case 'invoices':
        tableName = 'invoices';
        allowedFields = [
          'invoice_number', 'customer_name', 'invoice_date', 'due_date',
          'grand_total', 'status', 'payment_status', 'tax_amount', 'discount_amount'
        ];
        
        // Map display fields to actual database columns
        const invoiceFieldMap: Record<string, string> = {
          'invoice_number': 'i.invoice_number',
          'customer_name': 'c.name as customer_name',
          'invoice_date': 'i.invoice_date',
          'due_date': 'i.due_date',
          'grand_total': 'i.grand_total',
          'status': 'i.status',
          'payment_status': 'i.payment_status',
          'tax_amount': 'i.tax_amount',
          'discount_amount': 'i.discount_amount'
        };
        
        const selectedInvoiceFields = fields
          .filter(f => allowedFields.includes(f))
          .map(f => invoiceFieldMap[f] || f);
        
        query = `
          SELECT ${selectedInvoiceFields.length > 0 ? selectedInvoiceFields.join(', ') : 'i.*'}
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
          WHERE i.business_id = $1
          AND i.deleted_at IS NULL
          ORDER BY i.invoice_date DESC
          LIMIT 500
        `;
        break;

      case 'customers':
        tableName = 'customers';
        allowedFields = ['name', 'email', 'phone', 'gstin', 'city', 'state'];
        
        // Build dynamic query with aggregations
        const selectedFields = fields.filter(f => allowedFields.includes(f)).map(f => `c.${f}`);
        
        query = `
          SELECT 
            ${selectedFields.join(', ')}
            ${selectedFields.length > 0 ? ',' : ''}
            COALESCE(SUM(i.total), 0) as total_sales,
            COUNT(i.id) as invoice_count
          FROM customers c
          LEFT JOIN invoices i ON c.id = i.customer_id AND i.deleted_at IS NULL
          WHERE c.business_id = $1
          AND c.deleted_at IS NULL
          GROUP BY c.id ${selectedFields.length > 0 ? ', ' + selectedFields.join(', ') : ''}
          ORDER BY total_sales DESC
          LIMIT 500
        `;
        break;

      case 'items':
        tableName = 'items';
        allowedFields = ['name', 'sku', 'price', 'unit', 'hsn_code', 'category'];
        
        const itemFields = fields.filter(f => allowedFields.includes(f)).map(f => `i.${f}`);
        
        query = `
          SELECT 
            ${itemFields.join(', ')}
            ${itemFields.length > 0 ? ',' : ''}
            COALESCE(SUM(s.quantity), 0) as stock
          FROM items i
          LEFT JOIN stock s ON i.id = s.item_id
          WHERE i.business_id = $1
          GROUP BY i.id ${itemFields.length > 0 ? ', ' + itemFields.join(', ') : ''}
          ORDER BY i.name
          LIMIT 500
        `;
        break;

      case 'purchases':
        tableName = 'purchases';
        allowedFields = [
          'bill_number', 'supplier_name', 'bill_date', 'due_date',
          'grand_total', 'status', 'payment_status'
        ];
        
        // Map display fields to actual database columns
        const purchaseFieldMap: Record<string, string> = {
          'bill_number': 'p.bill_number',
          'supplier_name': 's.name as supplier_name',
          'bill_date': 'p.bill_date',
          'due_date': 'p.due_date',
          'grand_total': 'p.grand_total',
          'status': 'p.status',
          'payment_status': 'p.payment_status'
        };
        
        const selectedPurchaseFields = fields
          .filter(f => allowedFields.includes(f))
          .map(f => purchaseFieldMap[f] || f);
        
        query = `
          SELECT ${selectedPurchaseFields.length > 0 ? selectedPurchaseFields.join(', ') : 'p.*'}
          FROM purchases p
          LEFT JOIN suppliers s ON p.supplier_id = s.id
          WHERE p.business_id = $1
          AND p.deleted_at IS NULL
          ORDER BY p.bill_date DESC
          LIMIT 500
        `;
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid entity type' },
          { status: 400 }
        );
    }

    // Execute query
    const results = await db.queryRows(query, [business_id]);

    return NextResponse.json({
      success: true,
      entity_type,
      fields,
      count: results.length,
      results,
    });
  } catch (error: unknown) {
    console.error('Error generating report:', error);
    if (error instanceof FeatureAccessDeniedError) {
      return error.toNextResponse();
    }
    const message = error instanceof Error ? error.message : 'Failed to generate report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
