export type PackableLine = {
  id: string;
  item_name: string;
  quantity: number;
  packed_qty: number;
  code: string | null;
  barcode: string | null;
};

function norm(s: string): string {
  return s.trim().toUpperCase();
}

export function matchPackScan(lines: PackableLine[], raw: string): PackableLine | null {
  const code = norm(raw);
  if (code.length < 2) return null;
  const unpacked = lines.filter((l) => l.packed_qty < l.quantity);
  return (
    unpacked.find((l) => l.barcode && norm(l.barcode) === code) ||
    unpacked.find((l) => l.code && norm(l.code) === code) ||
    null
  );
}

export function matchOrderNumber(
  orders: Array<{ id: string; order_number: string; awb?: string | null }>,
  raw: string,
): string | null {
  const code = norm(raw);
  const hit = orders.find(
    (o) => norm(o.order_number) === code || (o.awb && norm(o.awb) === code),
  );
  return hit?.id ?? null;
}

/** Courier AWB / tracking barcodes are typically long Code-128, not a short SKU. */
export function looksLikeCourierBarcode(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 8) return false;
  if (/^https?:\/\//i.test(s)) return true;
  return /^[A-Z0-9-]{8,40}$/i.test(s);
}

export function allLinesPacked(lines: PackableLine[]): boolean {
  if (lines.length === 0) return false;
  return lines.every((l) => l.packed_qty >= l.quantity);
}
