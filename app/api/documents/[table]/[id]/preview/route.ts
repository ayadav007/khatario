import { NextRequest, NextResponse } from 'next/server';
import { finalizePrintHtml, generateDocumentHtml, DocumentTable } from '@/lib/pdf-generator';

export async function GET(
  req: NextRequest,
  { params }: { params: { table: string; id: string } }
) {
  try {
    const { table, id } = params;
    
    // Validate table name
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

    const { html, templateId, settings, businessId } = await generateDocumentHtml(id, table as DocumentTable);
    const finalizedHtml = await finalizePrintHtml(html, templateId, settings, businessId);

    return NextResponse.json({ html: finalizedHtml, templateId });

  } catch (error: any) {
    console.error(`Error generating ${params.table} preview:`, error);
    const status = error.message === 'Document not found' ? 404 : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to generate preview' },
      { status }
    );
  }
}

