import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { DocumentTable } from '@/lib/pdf-generator';

export async function GET(
  req: NextRequest,
  { params }: { params: { table: string; id: string } }
) {
  try {
    const { table, id } = params;
    
    const validTables: DocumentTable[] = [
      'invoices', 
      'sales_orders', 
      'delivery_challans', 
      'credit_notes', 
      'debit_notes', 
      'purchase_orders', 
      'work_orders'
    ];

    if (!validTables.includes(table as DocumentTable)) {
      return NextResponse.json({ error: 'Invalid document type' }, { status: 400 });
    }

    const itemTableMap: Record<string, string> = {
      'invoices': 'invoice_items',
      'sales_orders': 'sales_order_items',
      'delivery_challans': 'delivery_challan_items',
      'credit_notes': 'credit_note_items',
      'debit_notes': 'debit_note_items',
      'purchase_orders': 'purchase_order_items',
      'work_orders': 'work_order_items'
    };

    const idColumnMap: Record<string, string> = {
      'invoices': 'invoice_id',
      'sales_orders': 'sales_order_id',
      'delivery_challans': 'delivery_challan_id',
      'credit_notes': 'credit_note_id',
      'debit_notes': 'debit_note_id',
      'purchase_orders': 'purchase_order_id',
      'work_orders': 'work_order_id'
    };

    const partyJoin =
      table === 'purchase_orders'
        ? `LEFT JOIN suppliers c ON doc.supplier_id = c.id`
        : `LEFT JOIN customers c ON doc.customer_id = c.id`;

    const partySelect =
      table === 'purchase_orders'
        ? `c.name as party_name,
           c.email as party_email,
           c.phone as party_phone,
           c.address as party_address,
           c.gstin as party_gstin`
        : `c.name as party_name,
           c.email as party_email,
           c.phone as party_phone`;

    const doc = await db.queryOne(
      `SELECT doc.*, ${partySelect}
       FROM ${table} doc
       ${partyJoin}
       WHERE doc.id = $1`,
      [id]
    );

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const items = await db.queryRows(
      `SELECT ii.*, COALESCE(ii.item_name, i.name) as item_name
       FROM ${itemTableMap[table]} ii
       LEFT JOIN items i ON ii.item_id = i.id
       WHERE ii.${idColumnMap[table]} = $1
       ORDER BY ii.sort_order, ii.id`,
      [id]
    );

    return NextResponse.json({ document: doc, items });

  } catch (error: any) {
    console.error(`Error fetching ${params.table} detail:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

