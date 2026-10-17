/**
 * Return-readiness acknowledgements are bound to an issue, not to a whole snapshot.
 * A new snapshot keeps an acknowledgement when that issue's key, facts, and tax-head
 * amounts are unchanged. A changed issue needs a fresh acknowledgement. The old row stays.
 */

export interface TaxHeads {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface AckIssue {
  key: string;
  facts: Record<string, string | number | boolean | null>;
  amounts: TaxHeads;
}

export interface StoredAcknowledgement {
  id: string;
  issueKey: string;
  snapshotId: string;
  facts: Record<string, string | number | boolean | null>;
  amounts: TaxHeads;
  userId: string;
  acknowledgedAt: string;
  invalidatedAt: string | null;
}

export interface AcknowledgementReconciliation {
  stillValid: StoredAcknowledgement[];
  invalidated: StoredAcknowledgement[];
  needsAcknowledgement: AckIssue[];
}

const HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;

function amountsEqual(a: TaxHeads, b: TaxHeads): boolean {
  return HEADS.every((h) => Math.abs(r2(a[h] ?? 0) - r2(b[h] ?? 0)) < 0.005);
}

function factsEqual(
  a: Record<string, string | number | boolean | null>,
  b: Record<string, string | number | boolean | null>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function issueUnchanged(stored: StoredAcknowledgement, current: AckIssue): boolean {
  return stored.issueKey === current.key && factsEqual(stored.facts, current.facts) && amountsEqual(stored.amounts, current.amounts);
}

/**
 * Compare the current issues to acknowledgements by stable issue key, facts, and amounts.
 * Snapshot id is recorded for audit and is not itself a reason to drop an unchanged issue.
 */
export function reconcileAcknowledgements(
  stored: StoredAcknowledgement[],
  current: AckIssue[]
): AcknowledgementReconciliation {
  const active = stored.filter((s) => !s.invalidatedAt);
  const byKey = new Map<string, AckIssue>();
  for (const issue of current) byKey.set(issue.key, issue);

  const stillValid: StoredAcknowledgement[] = [];
  const invalidated: StoredAcknowledgement[] = [];
  const acknowledgedKeys = new Set<string>();

  for (const ack of active) {
    const issue = byKey.get(ack.issueKey);
    if (issue && issueUnchanged(ack, issue)) {
      stillValid.push(ack);
      acknowledgedKeys.add(ack.issueKey);
    } else {
      invalidated.push(ack);
    }
  }

  const needsAcknowledgement = current.filter((issue) => !acknowledgedKeys.has(issue.key));
  return { stillValid, invalidated, needsAcknowledgement };
}

export function aboveRounding(amounts: TaxHeads): boolean {
  return HEADS.some((h) => Math.abs(r2(amounts[h] ?? 0)) > 1);
}
