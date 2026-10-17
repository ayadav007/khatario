/**
 * Versioned reverse-charge hints. An empty catalogue does not detect RCM.
 * A blank GSTIN is not a match.
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
}

export interface RcmBillFacts {
  billDate: string;
  registrationStatus: 'registered' | 'unregistered' | 'unknown';
  reverseCharge: boolean;
  sac: string | null;
  hsn: string | null;
  expenseCategory: string | null;
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
