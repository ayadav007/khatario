import { gstCalendarDateInTz } from '@/lib/gst/gst-calendar';
import { computeGstChargesFull } from '@/lib/gst/gst-charges-compute';
import { loadGstFilingOrgDefaults, mergeGstDueDateOptions } from '@/lib/gst/gst-org-filing';
import type { GSTR3BData } from '@/lib/gst/gstr3b';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * GSTR-3B Table 5.1 for a return filed and paid on `filingDate` (default today, IST): interest
 * under s.50 on the cash portion paid late, and the late fee under s.47. Interest runs at the same
 * rate on every head, so the total is split in proportion to the cash payable by head. The late
 * fee is levied under the CGST and SGST Acts in equal halves.
 */
export async function fillTable51(
  data: GSTR3BData,
  p: { businessId: string; branchId: string | null; gstPeriod: string; filingDate?: string }
): Promise<void> {
  const filing = p.filingDate || gstCalendarDateInTz();
  const dueDateOptions = mergeGstDueDateOptions(await loadGstFilingOrgDefaults(p.businessId, p.branchId));
  const charges = await computeGstChargesFull({
    businessId: p.businessId,
    branchId: p.branchId ?? undefined,
    gstPeriod: p.gstPeriod,
    netTaxPayable: Number(data.summary.net_tax_payable) || 0,
    filingDate: filing,
    paymentDate: filing,
    dueDateOptions,
    asOnDate: filing,
  } as Parameters<typeof computeGstChargesFull>[0]);

  const heads = data.tax_liability;
  const pooledRcm = Number(data.summary.rcm_pooled_component) || 0;
  const weight = {
    igst: Math.max(0, heads.igst),
    cgst: Math.max(0, heads.cgst) + pooledRcm / 2,
    sgst: Math.max(0, heads.sgst) + pooledRcm / 2,
    cess: Math.max(0, heads.cess),
  };
  const total = weight.igst + weight.cgst + weight.sgst + weight.cess;
  const share = (w: number) => (total > 0 ? r2((charges.interest * w) / total) : 0);
  const interest = { igst: share(weight.igst), cgst: share(weight.cgst), sgst: share(weight.sgst), cess: share(weight.cess) };
  // Paise left by rounding go to the head carrying the most interest.
  const largest = (Object.keys(weight) as Array<keyof typeof weight>).reduce((a, b) => (weight[b] > weight[a] ? b : a));
  interest[largest] = r2(interest[largest] + charges.interest - interest.igst - interest.cgst - interest.sgst - interest.cess);
  const halfFee = r2(charges.late_fee / 2);
  const late_fee = { cgst: halfFee, sgst: r2(charges.late_fee - halfFee) };

  data.interest = interest;
  data.late_fee = late_fee;
  data.interest_late_fee = {
    igst: interest.igst,
    cgst: r2(interest.cgst + late_fee.cgst),
    sgst: r2(interest.sgst + late_fee.sgst),
    cess: interest.cess,
  };
  data.table_51_basis = { filing_date: filing, due_date: charges.due_date, days_late: charges.days_delayed };
}
