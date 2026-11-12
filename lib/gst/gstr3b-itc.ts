/**
 * GSTR-3B Table 4 (ITC) from the input GST ledger and the inward documents of the period.
 *
 * Circular 170/02/2022: credit reversed for good (Rule 38/42/43, s.17(5)) goes in 4B(1); credit
 * reversed that can be re-claimed later (Rule 37, supplier unpaid after 180 days) goes in 4B(2).
 * Credit re-claimed when the supplier is paid is part of 4A(5) and is also shown in 4D(1).
 */
import type { TaxBreakdown } from './gstr3b';
import {
  GSTR3B_INPUT_CESS,
  GSTR3B_INPUT_CGST,
  GSTR3B_INPUT_IGST,
  GSTR3B_INPUT_SGST,
  round2,
} from './gstr3b-ledger';
import type { ItcHeads } from './itc-2b-gate';
import { RULE37_REAVAIL, RULE37_REVERSAL } from './rule37';

export interface ITCDetails {
  /** 4A(1) import of goods */
  imports: TaxBreakdown;
  /** 4A(2) import of services */
  import_services: TaxBreakdown;
  /** 4A(3) inward supplies liable to reverse charge */
  inward_reverse_charge: TaxBreakdown;
  /** 4A(5) all other ITC, before the 4(B) reversals; includes credit re-claimed in 4D(1). */
  other_itc: TaxBreakdown;
  /** 4B(1) Rule 38/42/43 and s.17(5): blocked credit and stock lost, destroyed or given away. */
  itc_reversed_rules: TaxBreakdown;
  /** 4B(2) others: Rule 37 reversals, which are re-claimed once the supplier is paid. */
  itc_reversed_others: TaxBreakdown;
  /** 4(B) total, 4B(1) + 4B(2). */
  itc_reversed: TaxBreakdown;
  /** 4C net ITC available, 4(A) − 4(B). */
  net_itc: TaxBreakdown;
  /** 4D(1) credit reversed under 4B(2) in an earlier period and re-claimed in this one (already in 4A(5)). */
  itc_reclaimed: TaxBreakdown;
}

/** Ledger vouchers that move credit out of, or back into, input GST outside a document. */
export const ITC_MOVEMENT_VOUCHER_TYPES = ['itc_reversal', RULE37_REVERSAL, RULE37_REAVAIL] as const;

export const ITC_INPUT_ACCOUNT_CODES = [GSTR3B_INPUT_IGST, GSTR3B_INPUT_CGST, GSTR3B_INPUT_SGST, GSTR3B_INPUT_CESS];

const HEAD_BY_ACCOUNT: Record<string, keyof ItcHeads> = {
  [GSTR3B_INPUT_IGST]: 'igst',
  [GSTR3B_INPUT_CGST]: 'cgst',
  [GSTR3B_INPUT_SGST]: 'sgst',
  [GSTR3B_INPUT_CESS]: 'cess',
};

const zeroHeads = (): ItcHeads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });

export interface ItcLedgerMovements {
  /** 4B(1): s.17(5)(h) reversals (`itc_reversal`). */
  rules: ItcHeads;
  /** 4B(2): Rule 37 reversals (`itc_reversal_r37`). */
  others: ItcHeads;
  /** 4D(1): Rule 37 credit re-claimed on payment (`itc_reavail_r37`). */
  reclaimed: ItcHeads;
}

/** Sort ledger nets (credit − debit on 1110–1113, by voucher type) into the 4(B) and 4D(1) heads. */
export function itcLedgerMovements(
  rows: Array<{ voucher_type: string; account_code: string; amt: number | string }>
): ItcLedgerMovements {
  const out: ItcLedgerMovements = { rules: zeroHeads(), others: zeroHeads(), reclaimed: zeroHeads() };
  for (const r of rows) {
    const head = HEAD_BY_ACCOUNT[r.account_code];
    if (!head) continue;
    const amt = Number(r.amt) || 0;
    if (r.voucher_type === 'itc_reversal') out.rules[head] += amt;
    else if (r.voucher_type === RULE37_REVERSAL) out.others[head] += amt;
    // Re-availment debits input GST, so its credit − debit is negative.
    else if (r.voucher_type === RULE37_REAVAIL) out.reclaimed[head] -= amt;
  }
  for (const k of ['rules', 'others', 'reclaimed'] as const) {
    for (const h of Object.keys(out[k]) as Array<keyof ItcHeads>) out[k][h] = round2(out[k][h]);
  }
  return out;
}

const heads = (h: ItcHeads): TaxBreakdown => ({
  taxable_value: 0,
  igst: round2(h.igst),
  cgst: round2(h.cgst),
  sgst: round2(h.sgst),
  cess: round2(h.cess),
});

export function buildItcTable4(p: {
  /** Input GST ledger net for the period (1110–1113), after every reversal and re-claim. */
  books: ItcHeads;
  imports: TaxBreakdown;
  import_services: TaxBreakdown;
  inward_reverse_charge: TaxBreakdown;
  /** s.17(5) blocked credit on bills of the period: shown in 4A and reversed in 4B(1). */
  blocked: TaxBreakdown;
  movements: ItcLedgerMovements;
  /** GSTR-2B gate on 4A(5) (s.16(2)(aa)). */
  held: ItcHeads;
  released: ItcHeads;
}): ITCDetails {
  const { movements: m } = p;
  // 4A(5): books ITC less the credits reported in 4A(1)-(3) and less what GSTR-2B does not
  // support yet, plus earlier credit 2B now supports, plus credit reversed in 4(B).
  const otherHead = (head: 'igst' | 'cgst' | 'sgst') =>
    round2(
      Math.max(
        0,
        p.books[head] + m.rules[head] + m.others[head] - p.imports[head] - p.import_services[head] -
          p.inward_reverse_charge[head] - p.held[head] + p.released[head]
      ) + p.blocked[head]
    );
  const other_itc: TaxBreakdown = {
    taxable_value: 0,
    igst: otherHead('igst'),
    cgst: otherHead('cgst'),
    sgst: otherHead('sgst'),
    cess: round2(
      Math.max(0, p.books.cess - p.held.cess + p.released.cess) + p.blocked.cess + m.rules.cess + m.others.cess
    ),
  };
  const itc_reversed_rules = heads({
    igst: p.blocked.igst + m.rules.igst,
    cgst: p.blocked.cgst + m.rules.cgst,
    sgst: p.blocked.sgst + m.rules.sgst,
    cess: p.blocked.cess + m.rules.cess,
  });
  const itc_reversed_others = heads(m.others);
  const itc_reversed = heads({
    igst: itc_reversed_rules.igst + itc_reversed_others.igst,
    cgst: itc_reversed_rules.cgst + itc_reversed_others.cgst,
    sgst: itc_reversed_rules.sgst + itc_reversed_others.sgst,
    cess: itc_reversed_rules.cess + itc_reversed_others.cess,
  });
  const fromDocs = (head: 'igst' | 'cgst' | 'sgst') =>
    p.imports[head] + p.import_services[head] + p.inward_reverse_charge[head];
  const net_itc = heads({
    igst: fromDocs('igst') + other_itc.igst - itc_reversed.igst,
    cgst: fromDocs('cgst') + other_itc.cgst - itc_reversed.cgst,
    sgst: fromDocs('sgst') + other_itc.sgst - itc_reversed.sgst,
    cess: other_itc.cess - itc_reversed.cess,
  });
  const itc_reclaimed = heads({
    igst: Math.max(0, m.reclaimed.igst),
    cgst: Math.max(0, m.reclaimed.cgst),
    sgst: Math.max(0, m.reclaimed.sgst),
    cess: Math.max(0, m.reclaimed.cess),
  });

  return {
    imports: p.imports,
    import_services: p.import_services,
    inward_reverse_charge: p.inward_reverse_charge,
    other_itc,
    itc_reversed_rules,
    itc_reversed_others,
    itc_reversed,
    net_itc,
    itc_reclaimed,
  };
}
