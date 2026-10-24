/**
 * Pure depreciation rules:
 *  - Companies Act 2013 Schedule II useful lives and day-based pro rata book depreciation.
 *  - Income-tax Act s.32 block-of-assets WDV, half rate when put to use < 180 days in the FY.
 * Dates are ISO `YYYY-MM-DD` strings to avoid timezone drift.
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ItBlock {
  key: string;
  label: string;
  rate: number;
}

/** Income-tax Rules, Appendix I (post AY 2018-19 rates). */
export const IT_BLOCKS: ItBlock[] = [
  { key: 'building_residential', label: 'Building - residential', rate: 5 },
  { key: 'building_other', label: 'Building - other than residential', rate: 10 },
  { key: 'building_temporary', label: 'Building - purely temporary structures', rate: 40 },
  { key: 'furniture', label: 'Furniture and fittings (incl. electrical fittings)', rate: 10 },
  { key: 'plant_general', label: 'Plant and machinery - general', rate: 15 },
  { key: 'motor_car', label: 'Motor cars (not used in hire business)', rate: 15 },
  { key: 'motor_hire', label: 'Motor vehicles used in hire business', rate: 30 },
  { key: 'computers', label: 'Computers and computer software', rate: 40 },
  { key: 'books_annual', label: 'Books (annual publications) / professional books', rate: 40 },
  { key: 'pollution_control', label: 'Pollution control / energy saving devices', rate: 40 },
  { key: 'intangibles', label: 'Intangibles (know-how, patents, copyrights, licences)', rate: 25 },
];

export interface ScheduleIICategory {
  key: string;
  label: string;
  usefulLifeYears: number;
}

/** Companies Act 2013 Schedule II Part C, common categories. */
export const SCHEDULE_II: ScheduleIICategory[] = [
  { key: 'building_rcc', label: 'Buildings (RCC frame, other than factory)', usefulLifeYears: 60 },
  { key: 'building_non_rcc', label: 'Buildings (non-RCC frame, other than factory)', usefulLifeYears: 30 },
  { key: 'building_factory', label: 'Factory buildings', usefulLifeYears: 30 },
  { key: 'building_temporary', label: 'Temporary structures', usefulLifeYears: 3 },
  { key: 'plant_general', label: 'Plant and machinery - general (not continuous process)', usefulLifeYears: 15 },
  { key: 'plant_continuous', label: 'Plant and machinery - continuous process plant', usefulLifeYears: 25 },
  { key: 'furniture', label: 'Furniture and fittings', usefulLifeYears: 10 },
  { key: 'electrical', label: 'Electrical installations and equipment', usefulLifeYears: 10 },
  { key: 'office_equipment', label: 'Office equipment', usefulLifeYears: 5 },
  { key: 'computer_end_user', label: 'Computers - end user devices (desktops, laptops)', usefulLifeYears: 3 },
  { key: 'computer_server', label: 'Computers - servers and networks', usefulLifeYears: 6 },
  { key: 'motor_car', label: 'Motor cars (other than hire business)', usefulLifeYears: 8 },
  { key: 'motor_two_wheeler', label: 'Motor cycles, scooters and other mopeds', usefulLifeYears: 10 },
  { key: 'motor_hire', label: 'Motor buses, lorries, taxis used in hire business', usefulLifeYears: 6 },
  { key: 'motor_other', label: 'Motor buses, lorries and other vehicles', usefulLifeYears: 8 },
];

export function itBlockByKey(key: string | null | undefined): ItBlock | undefined {
  return IT_BLOCKS.find((b) => b.key === key);
}

export function scheduleIIByKey(key: string | null | undefined): ScheduleIICategory | undefined {
  return SCHEDULE_II.find((c) => c.key === key);
}

function toUtc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Inclusive day count; 0 when `to` is before `from`. */
export function daysInclusive(from: string, to: string): number {
  const diff = Math.round((toUtc(to) - toUtc(from)) / 86_400_000) + 1;
  return diff > 0 ? diff : 0;
}

/** Start year of the Indian FY (April-March) containing the date. */
export function fyStartYear(iso: string): number {
  const [y, m] = iso.slice(0, 10).split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

export function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function parseFyLabel(label: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(label.trim());
  if (!m) return null;
  const start = Number(m[1]);
  return (start + 1) % 100 === Number(m[2]) ? start : null;
}

/** WDV rate implied by Schedule II: 1 - (residual/cost)^(1/life); residual defaults to 5%. */
export function wdvRateFromLife(usefulLifeYears: number, residualFraction = 0.05): number {
  if (!(usefulLifeYears > 0)) return 0;
  const frac = residualFraction > 0 ? residualFraction : 0.05;
  return r2((1 - Math.pow(frac, 1 / usefulLifeYears)) * 100);
}

export interface BookDepreciationInput {
  method: 'SLM' | 'WDV';
  cost: number;
  residual: number;
  usefulLifeYears: number;
  /** Annual WDV rate in percent; derived from useful life when absent. */
  ratePct?: number | null;
  openingBookValue: number;
  periodStart: string;
  periodEnd: string;
  putToUseDate: string;
}

/**
 * Schedule II book depreciation for a period, pro rata by days in use (days / 365),
 * never taking the book value below the residual value.
 */
export function bookDepreciation(p: BookDepreciationInput): { amount: number; daysUsed: number; annual: number } {
  const start = toUtc(p.periodStart) > toUtc(p.putToUseDate) ? p.periodStart : p.putToUseDate;
  const daysUsed = daysInclusive(start, p.periodEnd);
  let annual = 0;
  if (p.method === 'SLM') {
    annual = p.usefulLifeYears > 0 ? (p.cost - p.residual) / p.usefulLifeYears : 0;
  } else {
    const rate = p.ratePct && p.ratePct > 0
      ? p.ratePct
      : wdvRateFromLife(p.usefulLifeYears, p.cost > 0 ? p.residual / p.cost : 0.05);
    annual = (p.openingBookValue * rate) / 100;
  }
  let amount = (annual * daysUsed) / 365;
  const headroom = p.openingBookValue - p.residual;
  if (amount > headroom) amount = headroom;
  if (amount < 0) amount = 0;
  return { amount: r2(amount), daysUsed, annual: r2(annual) };
}

export interface ItAsset {
  block: string;
  cost: number;
  putToUseDate: string;
  disposalDate?: string | null;
  disposalProceeds?: number | null;
}

export interface ItBlockRow {
  block: string;
  label: string;
  rate: number;
  openingWdv: number;
  additionsFullRate: number;
  additionsHalfRate: number;
  sales: number;
  depreciation: number;
  closingWdv: number;
  /** Positive: s.50 short-term capital gain; negative: short-term capital loss on block ceasing. */
  shortTermCapitalGain: number;
}

/** Put to use for fewer than 180 days in the FY of first use, so only half the rate is allowed. */
export function isHalfRateAddition(putToUseDate: string): boolean {
  const fyEnd = `${fyStartYear(putToUseDate) + 1}-03-31`;
  return daysInclusive(putToUseDate, fyEnd) < 180;
}

function blockYear(
  opening: number,
  addFull: number,
  addHalf: number,
  sales: number,
  rate: number,
  blockCeases: boolean
): { dep: number; closing: number; stcg: number } {
  const base = opening + addFull + addHalf - sales;
  if (base < 0) return { dep: 0, closing: 0, stcg: r2(-base) };
  if (blockCeases) return { dep: 0, closing: 0, stcg: r2(-base) };
  let full = opening + addFull - sales;
  let half = addHalf;
  if (full < 0) {
    half += full;
    full = 0;
  }
  const dep = r2((full * rate) / 100 + (half * rate) / 200);
  return { dep, closing: r2(base - dep), stcg: 0 };
}

/**
 * Block WDV computation up to and including `fy` (e.g. "2026-27"), carrying forward
 * closing WDV from the first FY an asset in the block was put to use.
 */
export function computeItBlocks(
  assets: ItAsset[],
  fy: string,
  openingWdvByBlock: Record<string, number> = {}
): ItBlockRow[] {
  const target = parseFyLabel(fy);
  if (target == null) throw new Error(`Invalid financial year: ${fy}`);

  const byBlock = new Map<string, ItAsset[]>();
  for (const a of assets) {
    if (!itBlockByKey(a.block)) continue;
    const list = byBlock.get(a.block) ?? [];
    list.push(a);
    byBlock.set(a.block, list);
  }
  for (const key of Object.keys(openingWdvByBlock)) {
    if (itBlockByKey(key) && !byBlock.has(key)) byBlock.set(key, []);
  }

  const rows: ItBlockRow[] = [];
  for (const [key, list] of byBlock) {
    const block = itBlockByKey(key)!;
    const years = list.map((a) => fyStartYear(a.putToUseDate));
    const first = Math.min(target, ...years);
    let wdv = openingWdvByBlock[key] ?? 0;
    let row: ItBlockRow | null = null;

    for (let y = first; y <= target; y++) {
      const fyStart = `${y}-04-01`;
      const fyEnd = `${y + 1}-03-31`;
      const inYear = (d?: string | null) => !!d && toUtc(d) >= toUtc(fyStart) && toUtc(d) <= toUtc(fyEnd);

      let addFull = 0;
      let addHalf = 0;
      let sales = 0;
      for (const a of list) {
        if (inYear(a.putToUseDate)) {
          if (isHalfRateAddition(a.putToUseDate)) addHalf += a.cost;
          else addFull += a.cost;
        }
        if (inYear(a.disposalDate)) sales += Number(a.disposalProceeds || 0);
      }
      const inUse = list.filter((a) => toUtc(a.putToUseDate) <= toUtc(fyEnd));
      const blockCeases =
        inUse.length > 0 &&
        inUse.every((a) => a.disposalDate && toUtc(a.disposalDate) <= toUtc(fyEnd)) &&
        sales > 0;

      const res = blockYear(wdv, addFull, addHalf, sales, block.rate, blockCeases);
      row = {
        block: key,
        label: block.label,
        rate: block.rate,
        openingWdv: r2(wdv),
        additionsFullRate: r2(addFull),
        additionsHalfRate: r2(addHalf),
        sales: r2(sales),
        depreciation: res.dep,
        closingWdv: res.closing,
        shortTermCapitalGain: res.stcg,
      };
      wdv = res.closing;
    }
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}
