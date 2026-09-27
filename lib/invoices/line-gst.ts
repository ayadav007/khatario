export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Exports / SEZ supplies under LUT or bond (without payment of IGST) are zero-rated:
 * the invoice carries no tax even though the place of supply is outside the state.
 */
export function isZeroRatedWithoutTax(opts: {
  is_export?: boolean | null;
  supply_type?: string | null;
  export_type?: string | null;
  lut_declaration?: boolean | null;
  place_of_supply_state_code?: string | null;
}): boolean {
  const supplyType = String(opts.supply_type || '').toLowerCase();
  const exportType = String(opts.export_type || '').toLowerCase();
  const zeroRatedSupply =
    !!opts.is_export ||
    supplyType === 'export' ||
    supplyType.startsWith('sez') ||
    opts.place_of_supply_state_code === '96' ||
    opts.place_of_supply_state_code === '97';
  if (!zeroRatedSupply) return false;
  if (exportType === 'wp' || supplyType === 'sez_wp') return false;
  return exportType === 'wop' || supplyType === 'sez_wop' || opts.lut_declaration === true;
}

/** Line GST split, each head rounded to paise so line, head and invoice totals always agree. */
export function computeLineGst(
  item: { quantity?: unknown; unit_price?: unknown; discount_percent?: unknown; tax_rate?: unknown },
  intraState: boolean,
  zeroRated: boolean
) {
  const itemSubtotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
  const itemDiscount = round2((itemSubtotal * (Number(item.discount_percent) || 0)) / 100);
  const taxable = round2(itemSubtotal - itemDiscount);
  const rate = zeroRated ? 0 : Number(item.tax_rate) || 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (intraState) {
    cgst = round2((taxable * rate) / 200);
    sgst = round2((taxable * rate) / 200);
  } else {
    igst = round2((taxable * rate) / 100);
  }
  const taxAmount = round2(cgst + sgst + igst);
  return { itemDiscount, taxable, cgst, sgst, igst, taxAmount, lineTotal: round2(taxable + taxAmount) };
}
