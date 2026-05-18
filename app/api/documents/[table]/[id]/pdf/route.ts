import { NextRequest, NextResponse } from 'next/server';
import { generateDocumentPdf, DocumentTable } from '@/lib/pdf-generator';

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

    const pdfBuffer = await generateDocumentPdf(id, table as DocumentTable);

    return new NextResponse(pdfBuffer as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${table}-${id}.pdf"`,
      },
    });

  } catch (error: any) {
    console.error(`Error generating ${params.table} PDF:`, error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}

