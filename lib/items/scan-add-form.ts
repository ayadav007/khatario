/**
 * Scan & Add Items: the new-item form a shopkeeper fills after a scan, and the POST /api/items
 * body built from it. Server validation in /api/items stays the authority; these checks only
 * catch what the shopkeeper can fix before saving.
 */

export interface ScanAddForm {
  barcode: string;
  name: string;
  brand: string;
  /** Pack size as printed, e.g. "100 g" or "500 ml". Saved as items.net_quantity. */
  size: string;
  unit: string;
  mrp: string;
  selling_price: string;
  purchase_price: string;
  tax_rate: string;
  hsn_sac: string;
  opening_stock: string;
}

export function emptyScanAddForm(barcode: string): ScanAddForm {
  return {
    barcode,
    name: '',
    brand: '',
    size: '',
    unit: 'PCS',
    mrp: '',
    selling_price: '',
    purchase_price: '',
    tax_rate: '0',
    hsn_sac: '',
    opening_stock: '',
  };
}

const blank = (v: string) => v.trim() === '';
const numberOrNull = (v: string) => (blank(v) ? null : Number(v));

export type ScanAddFormErrors = Partial<Record<keyof ScanAddForm, string>>;

export function validateScanAddForm(form: ScanAddForm): ScanAddFormErrors {
  const errors: ScanAddFormErrors = {};
  if (blank(form.name)) errors.name = 'Enter the product name';

  for (const field of ['mrp', 'selling_price', 'purchase_price', 'opening_stock'] as const) {
    const value = numberOrNull(form[field]);
    if (value !== null && (!Number.isFinite(value) || value < 0)) errors[field] = 'Enter a number, 0 or more';
  }

  const qty = numberOrNull(form.opening_stock) ?? 0;
  const cost = numberOrNull(form.purchase_price);
  // Opening stock is valued at purchase price in the ledger, so stock without a cost is refused.
  if (qty > 0 && !errors.purchase_price && (cost === null || cost <= 0)) {
    errors.purchase_price = 'Enter the purchase price for the stock you have';
  }

  const mrp = numberOrNull(form.mrp);
  const sell = numberOrNull(form.selling_price);
  if (mrp !== null && sell !== null && !errors.mrp && !errors.selling_price && sell > mrp) {
    errors.selling_price = 'Selling price is more than MRP';
  }

  if (!blank(form.hsn_sac) && !/^\d{4,8}$/.test(form.hsn_sac.replace(/\s/g, ''))) {
    errors.hsn_sac = 'HSN must be 4 to 8 digits';
  }
  return errors;
}

/** Body for POST /api/items. Never carries business_id or user ids; the server takes them from the session. */
export function scanAddItemPayload(form: ScanAddForm): Record<string, unknown> {
  const barcode = form.barcode.replace(/\s+/g, '');
  return {
    name: form.name.trim(),
    barcode: barcode || undefined,
    brand: form.brand.trim() || undefined,
    net_quantity: form.size.trim() || undefined,
    unit: form.unit || 'PCS',
    item_type: 'goods',
    mrp: numberOrNull(form.mrp) ?? undefined,
    selling_price: numberOrNull(form.selling_price) ?? 0,
    purchase_price: numberOrNull(form.purchase_price) ?? 0,
    tax_rate: numberOrNull(form.tax_rate) ?? 0,
    hsn_sac: form.hsn_sac.replace(/\s/g, '') || undefined,
    opening_stock: numberOrNull(form.opening_stock) ?? 0,
  };
}
