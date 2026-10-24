import { NextRequest, NextResponse } from 'next/server';
import { generateDocumentPdf } from '@/lib/pdf-generator';
import { requireDocumentReadAccess } from '@/lib/document-access';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { table: string; id: string } }
) {
  try {
    const { table, id } = params;

    const access = await requireDocumentReadAccess(req, table, id);
    if (!access.ok) return access.response;

    const pdfBuffer = await generateDocumentPdf(id, access.table);

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
