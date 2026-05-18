import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { GSTR3BGenerator, GSTR3BFilters } from '@/lib/gst/gstr3b';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const exportFormat = searchParams.get('export');
    
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const month = searchParams.get('month');
    const year = searchParams.get('year');

    if (!month || !year) {
      return NextResponse.json({ error: 'month and year are required' }, { status: 400 });
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

    const filters: GSTR3BFilters = {
      business_id,
      month: parseInt(month),
      year: parseInt(year),
      branch_id: finalBranchId,
    };

    const generator = new GSTR3BGenerator();
    const data = await generator.generate(filters);

    if (exportFormat === 'json') {
      const jsonOutput = {
        gstin: "URP",
        ret_period: `${month.padStart(2, '0')}${year}`,
        sup_details: {
          osup_det: {
            txval: data.outward_taxable_supplies.taxable_value,
            iamt: data.outward_taxable_supplies.igst,
            camt: data.outward_taxable_supplies.cgst,
            samt: data.outward_taxable_supplies.sgst,
            csamt: data.outward_taxable_supplies.cess
          },
          osup_det_by_nature: {
            inter_state: data.outward_taxable_supplies_nature.inter_state,
            intra_state: data.outward_taxable_supplies_nature.intra_state,
          },
          osup_zero: {
            txval: data.outward_zero_rated.taxable_value,
            iamt: data.outward_zero_rated.igst,
            csamt: data.outward_zero_rated.cess
          }
        },
        itc_elg: {
          itc_avl: [{
            ty: "IMPG",
            iamt: data.itc_details.imports.igst,
            camt: data.itc_details.imports.cgst,
            samt: data.itc_details.imports.sgst,
            csamt: data.itc_details.imports.cess
          }, {
            ty: "OTH",
            iamt: data.itc_details.other_itc.igst,
            camt: data.itc_details.other_itc.cgst,
            samt: data.itc_details.other_itc.sgst,
            csamt: data.itc_details.other_itc.cess
          }]
        },
        intr_ltfee: {
          intr_det: {
            iamt: data.interest_late_fee.igst,
            camt: data.interest_late_fee.cgst,
            samt: data.interest_late_fee.sgst,
            csamt: data.interest_late_fee.cess
          }
        },
        ledger_basis: data.ledger_basis,
        reconciliation: data.reconciliation,
        reconciliation_by_head: data.reconciliation_by_head,
        rcm_mode: data.rcm_mode,
        warnings: data.warnings,
        gross_output_tax: data.gross_output_tax,
        outward_supplies: data.outward_supplies,
        rcm: data.rcm,
        itc: data.itc,
        utilization: data.utilization,
        net_payable: data.net_payable,
      };
      
      return new NextResponse(JSON.stringify(jsonOutput, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="gstr3b_${month}_${year}.json"`
        }
      });
    }

    return NextResponse.json(data);

  } catch (error: any) {
    console.error('GSTR-3B Generation Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

