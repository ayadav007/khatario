/**
 * Versioned reverse-charge hints. An empty approved catalogue does not detect RCM.
 * Candidate rows are not operational. A blank GSTIN is unknown, not a match.
 * A code match is withheld when an exclusion, recipient class, or turnover
 * condition on the rule has not been supplied.
 */

export type RcmSupplierType = 'registered' | 'unregistered' | 'either';

export interface RcmRule {
  id: string;
  catalogueVersion: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  supplierType: RcmSupplierType;
  sacPrefix: string | null;
  hsnPrefix: string | null;
  expenseCategory: string | null;
  sourceCitation: string;
  reviewOnly: boolean;
  /** Absent on in-memory fixtures. Only `approved` rows are loaded from the database. */
  status?: 'candidate' | 'approved';
  recipientClass?: string | null;
  turnoverMin?: number | null;
  turnoverMax?: number | null;
  exclusions?: string[];
}

export interface RcmBillFacts {
  billDate: string;
  registrationStatus: 'registered' | 'unregistered' | 'unknown';
  reverseCharge: boolean;
  sac: string | null;
  hsn: string | null;
  expenseCategory: string | null;
  recipientClass?: string | null;
  annualTurnover?: number | null;
  /** True only when the caller has checked every exclusion on the matched rule. */
  exclusionsKnown?: boolean;
}

export type RcmMatch =
  | { result: 'not_checked'; coverage: 'incomplete' | 'outside_rules'; message: string }
  | { result: 'suspected'; citation: string; message: string; reviewOnly: boolean }
  | { result: 'no_warning'; message: string };

const INCOMPLETE =
  'RCM coverage: incomplete. No notified-supply rules are loaded.';

function prefixMatch(value: string | null, prefix: string | null): boolean {
  if (!prefix) return true;
  if (!value) return false;
  return value.replace(/\s/g, '').startsWith(prefix);
}

function supplierMatches(rule: RcmRule, status: RcmBillFacts['registrationStatus']): boolean {
  if (rule.supplierType === 'either') return status === 'registered' || status === 'unregistered';
  return rule.supplierType === status;
}

/** Database rows that may affect a bill. Candidates are ignored. */
export function approvedRcmRules<T extends { status?: string }>(rules: T[]): T[] {
  return rules.filter((rule) => rule.status === 'approved');
}

export function matchRcmRules(facts: RcmBillFacts, rules: RcmRule[]): RcmMatch {
  if (rules.length === 0) {
    return { result: 'not_checked', coverage: 'incomplete', message: INCOMPLETE };
  }
  const inForce = rules.filter((rule) => {
    if (facts.billDate < rule.effectiveFrom) return false;
    if (rule.effectiveTo && facts.billDate >= rule.effectiveTo) return false;
    return true;
  });
  for (const rule of inForce) {
    if (!supplierMatches(rule, facts.registrationStatus)) continue;
    const needsCode = Boolean(rule.sacPrefix || rule.hsnPrefix || rule.expenseCategory);
    if (!needsCode) continue;
    const codeKnown =
      (rule.sacPrefix && facts.sac) || (rule.hsnPrefix && facts.hsn) || (rule.expenseCategory && facts.expenseCategory);
    if (!codeKnown) {
      return {
        result: 'not_checked',
        coverage: 'outside_rules',
        message: 'RCM was not checked. Notified supplies are not detected without a SAC, HSN, or category.',
      };
    }
    const sacOk = prefixMatch(facts.sac, rule.sacPrefix);
    const hsnOk = prefixMatch(facts.hsn, rule.hsnPrefix);
    const categoryOk = !rule.expenseCategory || rule.expenseCategory === facts.expenseCategory;
    if (sacOk && hsnOk && categoryOk && (rule.sacPrefix ? Boolean(facts.sac) : true) && (rule.hsnPrefix ? Boolean(facts.hsn) : true)) {
      if (rule.exclusions && rule.exclusions.length > 0 && facts.exclusionsKnown !== true) {
        return {
          result: 'not_checked',
          coverage: 'outside_rules',
          message: 'RCM was not checked. An exclusion on this notification was not verified.',
        };
      }
      if (rule.recipientClass && !facts.recipientClass) {
        return {
          result: 'not_checked',
          coverage: 'outside_rules',
          message: 'RCM was not checked. The recipient class for this notification was not recorded.',
        };
      }
      if ((rule.turnoverMin != null || rule.turnoverMax != null) && facts.annualTurnover == null) {
        return {
          result: 'not_checked',
          coverage: 'outside_rules',
          message: 'RCM was not checked. The turnover condition for this notification was not recorded.',
        };
      }
      if (facts.reverseCharge) {
        return {
          result: 'no_warning',
          message: 'Reverse charge is already on. Registered-supplier reverse charge is valid for some notified supplies.',
        };
      }
      return {
        result: 'suspected',
        citation: rule.sourceCitation,
        reviewOnly: rule.reviewOnly,
        message: `This may be reverse charge under ${rule.sourceCitation}. Confirm.`,
      };
    }
  }
  if (facts.registrationStatus === 'unknown' || (!facts.sac && !facts.hsn && !facts.expenseCategory)) {
    return {
      result: 'not_checked',
      coverage: 'outside_rules',
      message: 'RCM was not checked. Notified supplies are not detected without a SAC, HSN, or category.',
    };
  }
  return {
    result: 'not_checked',
    coverage: 'outside_rules',
    message: 'RCM was not checked. No loaded rule matches this bill.',
  };
}
