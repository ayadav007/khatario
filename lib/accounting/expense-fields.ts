export type ExpenseCategoryRow = { account_id: string | null; itc_blocked: boolean };

const TDS_SECTIONS = new Set(['194C', '194J', '194H', '194I', '194IA', '194IB', '194Q', '194O', '194A', '192', 'OTHER']);

function bool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return undefined;
}

/**
 * ITC defaults to the category's s.17(5) setting (e.g. food and beverages is blocked)
 * unless the request says otherwise.
 */
export function parseExpenseTaxFields(
  body: Record<string, unknown>,
  category: ExpenseCategoryRow | null
): { itcEligible: boolean; isReverseCharge: boolean; tdsSection: string | null; tdsAmount: number } {
  const explicitItc = bool(body.itc_eligible);
  const itcEligible = explicitItc ?? !(category?.itc_blocked ?? false);
  const isReverseCharge = bool(body.is_reverse_charge) ?? false;
  const tdsAmount = Math.max(0, Math.round((Number(body.tds_amount) || 0) * 100) / 100);
  const rawSection = body.tds_section ? String(body.tds_section).trim().toUpperCase() : '';
  const tdsSection = tdsAmount > 0 ? (TDS_SECTIONS.has(rawSection) ? rawSection : 'OTHER') : null;
  return { itcEligible, isReverseCharge, tdsSection, tdsAmount };
}
