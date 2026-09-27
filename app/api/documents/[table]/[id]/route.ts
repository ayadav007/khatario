import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireDocumentReadAccess } from '@/lib/document-access';
import { hasTableColumn } from '@/lib/schema-columns';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { table: string; id: string } }
) {
  try {
    const { id } = params;

    const access = await requireDocumentReadAccess(req, params.table, id);
    if (!access.ok) return access.response;
    const { table, businessId } = access;

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
       WHERE doc.id = $1 AND doc.business_id = $2`,
      [id, businessId]
    );

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const itemTable = itemTableMap[table];
    const [hasItemName, hasSortOrder] = await Promise.all([
      hasTableColumn(itemTable, 'item_name'),
      hasTableColumn(itemTable, 'sort_order'),
    ]);

    const items = await db.queryRows(
      `SELECT ii.*, ${hasItemName ? 'COALESCE(ii.item_name, i.name)' : 'i.name'} as item_name
       FROM ${itemTable} ii
       LEFT JOIN items i ON ii.item_id = i.id
       WHERE ii.${idColumnMap[table]} = $1
       ORDER BY ${hasSortOrder ? 'ii.sort_order, ' : ''}ii.id`,
      [id]
    );

    return NextResponse.json({ document: doc, items });

  } catch (error: any) {
    console.error(`Error fetching ${params.table} detail:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
