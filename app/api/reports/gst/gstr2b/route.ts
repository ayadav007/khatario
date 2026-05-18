import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { GSTR2BGenerator, GSTR2BFilters } from '@/lib/gst/gstr2b';
import archiver from 'archiver';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const exportFormat = searchParams.get('export'); // 'csv' or 'json'
    
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription report access
    try {
      await assertReportAccess(business_id, 'gst');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
        businessId: business_id,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // Determine action based on export format
    const action = exportFormat ? 'export' : 'read';

    // AUTHORIZATION: Check read/export permission for GST report
    try {
      await authorize(userId, 'report.gst', action, {
        businessId: business_id,
        branchId: finalBranchId,
        resource: {
          business_id,
          branch_id: finalBranchId,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const filters: GSTR2BFilters = {
      business_id,
      month: searchParams.get('month') ? parseInt(searchParams.get('month')!) : undefined,
      year: searchParams.get('year') ? parseInt(searchParams.get('year')!) : undefined,
      from_date: searchParams.get('from_date') || undefined,
      to_date: searchParams.get('to_date') || undefined
    };

    const generator = new GSTR2BGenerator();
    const data = await generator.generate(filters);

    if (exportFormat === 'json') {
      const jsonOutput = {
        gstin: "URP",
        fp: `${(filters.month || 0).toString().padStart(2, '0')}${filters.year}`,
        b2b: data.b2b,
        b2bur: [], // Unregistered suppliers
        cdnr: data.cdnr,
        isd: [], // Input Service Distributor
        impg: data.imports,
        itc: data.itc_summary
      };
      
      return new NextResponse(JSON.stringify(jsonOutput, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="gstr2b_${filters.month}_${filters.year}.json"`
        }
      });
    } else if (exportFormat === 'csv') {
      // Generate CSV ZIP
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      
      archive.on('data', chunk => chunks.push(chunk));
      archive.on('end', () => {});
      
      // B2B CSV
      const b2bCSV = generateB2BCSV(data.b2b);
      archive.append(b2bCSV, { name: 'b2b_purchases.csv' });
      
      // Imports CSV
      const importsCSV = generateImportsCSV(data.imports);
      archive.append(importsCSV, { name: 'imports.csv' });
      
      await archive.finalize();
      const zipBuffer = Buffer.concat(chunks);
      
      return new NextResponse(zipBuffer as any, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="gstr2b_csv_${filters.month}_${filters.year}.zip"`
        }
      });
    }

    return NextResponse.json(data);

  } catch (error: any) {
    console.error('GSTR-2B Generation Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function generateB2BCSV(data: any[]): string {
  const headers = ['Supplier GSTIN', 'Supplier Name', 'Bill Number', 'Bill Date', 'Bill Value', 'Place of Supply', 'Reverse Charge', 'Rate', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'ITC Eligible', 'ITC Availed'];
  const rows = [headers.join(',')];
  
  data.forEach(row => {
    rows.push([
      row.supplier_gstin,
      `"${row.supplier_name}"`,
      row.bill_number,
      row.bill_date,
      row.bill_value,
      row.place_of_supply,
      row.reverse_charge,
      row.rate,
      row.taxable_value,
      row.igst,
      row.cgst,
      row.sgst,
      row.itc_eligible,
      row.itc_availed
    ].join(','));
  });
  
  return rows.join('\n');
}

function generateImportsCSV(data: any[]): string {
  const headers = ['Port Code', 'Bill Number', 'Bill Date', 'Bill Value', 'Taxable Value', 'IGST', 'Cess'];
  const rows = [headers.join(',')];
  
  data.forEach(row => {
    rows.push([
      row.port_code,
      row.bill_number,
      row.bill_date,
      row.bill_value,
      row.taxable_value,
      row.igst,
      row.cess
    ].join(','));
  });
  
  return rows.join('\n');
}

