/**
 * GSTR-3B Table 5 — values of exempt, nil-rated and non-GST inward supplies, derived from
 * purchase lines (not entered on the report).
 *
 * Row 1 "From a supplier under composition scheme, Exempt and Nil rated supply": inward lines
 * that carry no tax and are not reverse charge / imports (a composition or unregistered
 * supplier charges no tax; exempt and nil-rated lines carry 0%).
 * Row 2 "Non-GST supply": goods outside GST (s.9(2) petroleum products; alcoholic liquor for
 * human consumption), identified by HSN.
 */

export type Table5Bucket = 'composition_exempt_nil' | 'non_gst';

const NON_GST_HSN_PREFIXES = [
  '2709', // petroleum crude
  '27101241', '27101242', '27101243', '27101249', // motor spirit (petrol)
  '27101930', // high speed diesel
  '27101911', // aviation turbine fuel
  '271111', '271121', // natural gas
  '2203', '2204', '2205', '2206', '2208', // alcoholic liquor for human consumption
];

export function isNonGstHsn(hsn: string | null | undefined): boolean {
  const h = String(hsn || '').replace(/\D/g, '');
  return h.length >= 4 && NON_GST_HSN_PREFIXES.some((p) => h.startsWith(p));
}

export function classifyInwardLineForTable5(line: {
  taxAmount: number;
  hsn: string | null | undefined;
  isReverseCharge: boolean;
  isImport: boolean;
}): Table5Bucket | null {
  if (line.isReverseCharge || line.isImport) return null;
  if (isNonGstHsn(line.hsn)) return 'non_gst';
  if (Math.abs(line.taxAmount) < 0.005) return 'composition_exempt_nil';
  return null;
}

export interface Table5Row {
  inter_state: number;
  intra_state: number;
}

export interface GSTR3BTable5 {
  composition_exempt_nil: Table5Row;
  non_gst: Table5Row;
}

export function aggregateTable5(
  lines: Array<{
    taxableValue: number;
    taxAmount: number;
    hsn: string | null | undefined;
    isReverseCharge: boolean;
    isImport: boolean;
    supplierStateCode: string | null | undefined;
    recipientStateCode: string | null | undefined;
  }>
): GSTR3BTable5 {
  const out: GSTR3BTable5 = {
    composition_exempt_nil: { inter_state: 0, intra_state: 0 },
    non_gst: { inter_state: 0, intra_state: 0 },
  };
  for (const l of lines) {
    const bucket = classifyInwardLineForTable5(l);
    if (!bucket) continue;
    const s = String(l.supplierStateCode || '').slice(0, 2);
    const r = String(l.recipientStateCode || '').slice(0, 2);
    const inter = s.length === 2 && r.length === 2 && s !== r;
    out[bucket][inter ? 'inter_state' : 'intra_state'] += Number(l.taxableValue) || 0;
  }
  for (const b of Object.values(out)) {
    b.inter_state = Math.round(b.inter_state * 100) / 100;
    b.intra_state = Math.round(b.intra_state * 100) / 100;
  }
  return out;
}
