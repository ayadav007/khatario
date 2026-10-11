export type PackFields = {
  pack_size: number | null;
  pack_unit: string | null;
  error?: string;
};

export function normalizePack(input: {
  pack_size?: unknown;
  pack_unit?: unknown;
  unit?: unknown;
}): PackFields {
  const rawSize = input.pack_size;
  const rawUnit = String(input.pack_unit ?? '').trim();
  const emptySize = rawSize === undefined || rawSize === null || rawSize === '';
  const emptyUnit = rawUnit === '';
  if (emptySize && emptyUnit) return { pack_size: null, pack_unit: null };

  const size = Number(rawSize);
  if (!Number.isInteger(size) || size < 2 || size > 100000) {
    return { pack_size: null, pack_unit: null, error: 'Pack size must be a whole number from 2 to 100000' };
  }
  if (emptyUnit) {
    return { pack_size: null, pack_unit: null, error: 'Enter the pack name, such as CTN or BOX' };
  }
  const pack = rawUnit.slice(0, 20).toUpperCase();
  const base = String(input.unit || '').trim().toUpperCase();
  if (base && pack === base) {
    return { pack_size: null, pack_unit: null, error: 'Pack name must be different from the stock unit' };
  }
  return { pack_size: size, pack_unit: pack };
}

function trimNumber(qty: number): string {
  if (Math.abs(qty - Math.round(qty)) < 0.0001) return String(Math.round(qty));
  return qty.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

/** Stock stays in the base unit. A pack is only a display of whole packs plus leftover pieces. */
export function formatStockQuantity(
  quantity: number,
  unit?: string | null,
  packSize?: number | null,
  packUnit?: string | null,
): string {
  const baseUnit = (unit || 'PCS').trim() || 'PCS';
  const qty = Number(quantity);
  if (!Number.isFinite(qty)) return `0 ${baseUnit}`;

  const size = Number(packSize);
  const pack = (packUnit || '').trim();
  const wholePieces = Math.abs(qty - Math.round(qty)) < 0.0001;
  if (!pack || !Number.isInteger(size) || size < 2 || !wholePieces) {
    return `${trimNumber(qty)} ${baseUnit}`;
  }

  const whole = Math.round(qty);
  const sign = whole < 0 ? '-' : '';
  const abs = Math.abs(whole);
  const packs = Math.floor(abs / size);
  const remainder = abs % size;
  if (packs === 0) return `${sign}${remainder} ${baseUnit}`;
  if (remainder === 0) return `${sign}${packs} ${pack}`;
  return `${sign}${packs} ${pack} + ${remainder} ${baseUnit}`;
}
