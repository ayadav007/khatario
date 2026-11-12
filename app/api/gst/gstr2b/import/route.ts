export const dynamic = 'force-dynamic';

/**
 * GSTR-2B Import API
 *
 * Imports the GSTR-2B JSON or Excel workbook downloaded from the GST portal
 * into read-only tables for reconciliation. One row per document.
 */

import { NextRequest, NextResponse } from 'next/server';
import { assertGstr2bApiAccess } from '@/lib/gst/gstr2b-route-guard';
import { Gstr2bImportError, importGstr2bFile } from '@/lib/gst/gstr2b-import';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const business_id = formData.get('business_id') as string;
  const filing_period = formData.get('filing_period') as string;
  const file = formData.get('file') as File;

  if (!business_id || !filing_period || !file) {
    return NextResponse.json({ success: false, error: 'business_id, filing_period, and file are required' }, { status: 400 });
  }
  const access = await assertGstr2bApiAccess(request, business_id, 'create');
  if (!access.ok) return access.response;

  try {
    // A 2B belongs to one GSTIN. When the file does not name it, use the selected branch's registration.
    const branchParam = formData.get('branch_id');
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    const branchId = await resolveBranchId({
      businessId: access.businessId,
      branchId: typeof branchParam === 'string' && branchParam ? branchParam : undefined,
    }).catch(() => null);
    const result = await importGstr2bFile({
      businessId: access.businessId,
      userId: access.userId,
      branchId,
      filingPeriod: filing_period,
      fileName: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Gstr2bImportError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
          errors: error.details?.errors,
          sections: error.details?.sections,
          invoices_imported: 0,
        },
        { status: error.status }
      );
    }
    console.error('GSTR-2B Import Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to import GSTR-2B data', details: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    );
  }
}
