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

/** Shown beside Reverse charge while no approved rule is loaded. */
export const RCM_PURCHASE_INACTIVE_NOTICE =
  'Automatic RCM checks are not active yet. Please verify whether reverse charge applies to this purchase.';

export const RCM_EXPENSE_INACTIVE_NOTICE =
  'Automatic RCM checks are not active yet. Please verify whether reverse charge applies to this expense.';

/** Still shown after some rules are approved. A partial catalogue is not full detection. */
export const RCM_PURCHASE_PARTIAL_NOTICE =
  'Automatic RCM checks are not complete. Approved rules do not cover every notified supply. Please verify whether reverse charge applies to this purchase.';

export const RCM_EXPENSE_PARTIAL_NOTICE =
  'Automatic RCM checks are not complete. Approved rules do not cover every notified supply. Please verify whether reverse charge applies to this expense.';

export interface RcmDashboardStatus {
  status: string;
  approvedRules: number;
  action: string;
  explanation: string;
  /** This is a limit of automated coverage, not a mistake in the customer's books. */
  customerViolation: false;
  /** Must not stop a GSTR-1, GSTR-3B, or GSTR-9 file on its own. */
  blocksExport: false;
}

/**
 * The rule table can store approved rows. It has no marker that those rows are
 * the full notified-supply list, so a positive count is not complete coverage.
 */
export function rcmCatalogueIsComplete(_approvedCount: number): boolean {
  return false;
}

/** Null only when the approved catalogue is recorded as complete. That state is not available. */
export function formRcmNotice(kind: 'purchase' | 'expense', approvedCount: number): string | null {
  const inactive = kind === 'purchase' ? RCM_PURCHASE_INACTIVE_NOTICE : RCM_EXPENSE_INACTIVE_NOTICE;
  const partial = kind === 'purchase' ? RCM_PURCHASE_PARTIAL_NOTICE : RCM_EXPENSE_PARTIAL_NOTICE;
  if (!Number.isFinite(approvedCount) || approvedCount <= 0) return inactive;
  if (!rcmCatalogueIsComplete(approvedCount)) return partial;
  return null;
}

export function rcmDashboardStatus(approvedCount: number): RcmDashboardStatus {
  const count = Number.isFinite(approvedCount) && approvedCount > 0 ? Math.floor(approvedCount) : 0;
  if (count === 0) {
    return {
      status: 'Automatic RCM detection is not active.',
      approvedRules: 0,
      action: 'Verify RCM applicability manually when recording relevant purchases and expenses.',
      explanation: 'Khatario cannot currently detect all notified RCM transactions automatically.',
      customerViolation: false,
      blocksExport: false,
    };
  }
  return {
    status: 'Automatic RCM detection is limited to the approved rules loaded so far.',
    approvedRules: count,
    action: 'Verify RCM applicability manually when a purchase or expense is not covered by those rules.',
    explanation: 'An approved rule count does not mean every notified RCM category is covered.',
    customerViolation: false,
    blocksExport: false,
  };
}

export type RcmApplicability =
  | { outcome: 'inactive'; approvedCount: number; message: string }
  | { outcome: 'unverified'; approvedCount: number; reason: 'missing_facts' | 'no_match' | 'withheld'; message: string }
  | { outcome: 'matched'; approvedCount: number; citation: string; message: string };

/** A non-match is not a successful "no reverse charge" result. */
export function classifyRcmApplicability(approvedCount: number, match: RcmMatch): RcmApplicability {
  const count = Number.isFinite(approvedCount) && approvedCount > 0 ? Math.floor(approvedCount) : 0;
  if (count === 0 || (match.result === 'not_checked' && match.coverage === 'incomplete')) {
    return { outcome: 'inactive', approvedCount: count, message: RCM_PURCHASE_INACTIVE_NOTICE };
  }
  if (match.result === 'suspected' || match.result === 'no_warning') {
    return {
      outcome: 'matched',
      approvedCount: count,
      citation: match.result === 'suspected' ? match.citation : '',
      message: match.message,
    };
  }
  const missing = /SAC|HSN|category|exclusion|recipient|turnover|not recorded/i.test(match.message);
  return {
    outcome: 'unverified',
    approvedCount: count,
    reason: missing ? ( /exclusion|recipient|turnover/.test(match.message) ? 'withheld' : 'missing_facts' ) : 'no_match',
    message: match.message,
  };
}

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
