import { NextRequest, NextResponse } from 'next/server';
import { generateReconciliationExcel } from '@/lib/export/gstr2b-reconciliation-export';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const fromDate = searchParams.get('from_date') || undefined;
    const toDate = searchParams.get('to_date') || undefined;
    const status = searchParams.get('status') || undefined;

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const buffer = await generateReconciliationExcel({
      business_id: businessId,
      from_date: fromDate,
      to_date: toDate,
      status: status
    });

    return new NextResponse(buffer as any, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="GSTR-2B-Reconciliation-${new Date().toISOString().split('T')[0]}.xlsx"`,
      },
    });
  } catch (error: any) {
    console.error('Error exporting reconciliation data:', error);
    return NextResponse.json(
      { error: 'Failed to export reconciliation data', details: error.message },
      { status: 500 }
    );
  }
}

