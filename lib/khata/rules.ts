/**
 * What happens to a khata order when the customer is over the credit limit or has overdue bills
 * (docs/plan/STORE_KHATA.md, section 3). Pure.
 */

export type KhataRule = 'block' | 'warn' | 'approval';
export type KhataApprovalReason = 'over_limit' | 'overdue' | 'over_limit_overdue';

export const KHATA_RULES: readonly KhataRule[] = ['block', 'warn', 'approval'];

export function isKhataRule(v: unknown): v is KhataRule {
  return typeof v === 'string' && (KHATA_RULES as readonly string[]).includes(v);
}

export const KHATA_RULE_LABEL: Record<KhataRule, string> = {
  block: 'Block the order',
  warn: 'Allow and tell me',
  approval: 'Ask me to approve',
};

const STRICTNESS: Record<KhataRule, number> = { warn: 1, approval: 2, block: 3 };

export type KhataCheckInput = {
  /** Customer balance owed now (positive = owes the business). */
  balance: number;
  /** Khata orders placed but not yet invoiced (approval pending or posting). */
  pendingOrders: number;
  /** This order's total. */
  orderTotal: number;
  /** 0 = no limit. */
  creditLimit: number;
  /** Amount on bills past due date plus grace. */
  overdueAmount: number;
  overLimitRule: KhataRule;
  overdueRule: KhataRule;
};

export type KhataDecision = {
  outcome: 'allow' | KhataRule;
  overLimit: boolean;
  overdue: boolean;
  projected: number;
  /** How far over the limit the order takes the customer (0 when not over). */
  overBy: number;
  reason: KhataApprovalReason | null;
};

export function decideKhataOrder(input: KhataCheckInput): KhataDecision {
  const projected = round2(Math.max(0, input.balance) + Math.max(0, input.pendingOrders) + input.orderTotal);
  const overLimit = input.creditLimit > 0 && projected > input.creditLimit + 0.005;
  const overdue = input.overdueAmount > 0.005;
  const failed: KhataRule[] = [];
  if (overLimit) failed.push(input.overLimitRule);
  if (overdue) failed.push(input.overdueRule);
  const outcome = failed.length === 0 ? 'allow' : failed.reduce((a, b) => (STRICTNESS[b] > STRICTNESS[a] ? b : a));
  const reason: KhataApprovalReason | null =
    overLimit && overdue ? 'over_limit_overdue' : overLimit ? 'over_limit' : overdue ? 'overdue' : null;
  return {
    outcome,
    overLimit,
    overdue,
    projected,
    overBy: overLimit ? round2(projected - input.creditLimit) : 0,
    reason,
  };
}

export function khataReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case 'over_limit':
      return 'Over khata limit';
    case 'overdue':
      return 'Has overdue bills';
    case 'over_limit_overdue':
      return 'Over limit and overdue';
    default:
      return '';
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
