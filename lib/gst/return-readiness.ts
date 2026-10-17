/**
 * What may stop a portal file. A books difference above ₹1 does not.
 * Acknowledgements are per issue (see acknowledgements.ts).
 */

import { aboveRounding, reconcileAcknowledgements, type AckIssue, type StoredAcknowledgement, type TaxHeads } from '@/lib/gst/acknowledgements';
import { checkGstin } from '@/lib/tax/gstin';
import { annualReadinessIsCurrent, type PeriodState } from '@/lib/gst/period-freshness';

export interface PortalRow {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  placeOfSupply: string | null;
  gstin: string | null;
  included: boolean;
}

export interface HeadDifference {
  key: string;
  amounts: TaxHeads;
}

const zero = (): TaxHeads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });

export function gstr1BlockingIssues(rows: PortalRow[]): AckIssue[] {
  const issues: AckIssue[] = [];
  for (const row of rows) {
    if (!row.included) continue;
    if (row.gstin && row.gstin.trim()) {
      const checked = checkGstin(row.gstin);
      if (!checked.valid) {
        issues.push({
          key: `gstin:${row.id}`,
          facts: { code: checked.code, invoiceNumber: row.invoiceNumber },
          amounts: zero(),
        });
      }
    }
    if (!row.invoiceNumber || !row.invoiceDate || !row.placeOfSupply) {
      issues.push({
        key: `portal-field:${row.id}`,
        facts: {
          invoiceNumber: row.invoiceNumber,
          invoiceDate: row.invoiceDate,
          placeOfSupply: row.placeOfSupply,
        },
        amounts: zero(),
      });
    }
  }
  return issues;
}

export function differenceIssues(diffs: HeadDifference[]): AckIssue[] {
  return diffs
    .filter((d) => aboveRounding(d.amounts))
    .map((d) => ({ key: d.key, facts: { kind: 'head_difference' }, amounts: d.amounts }));
}

export function periodIssue(kind: string, periodKey: string, state: PeriodState): AckIssue | null {
  if (state === 'ready') return null;
  return {
    key: `period:${kind}:${periodKey}:${state}`,
    facts: { kind, periodKey, state },
    amounts: zero(),
  };
}

export interface DownloadAssessment {
  blocked: boolean;
  blockKeys: string[];
  needsAcknowledgement: AckIssue[];
  invalidated: StoredAcknowledgement[];
  annualCurrent: boolean | null;
}

export function assessDownload(input: {
  blocking: AckIssue[];
  review: AckIssue[];
  acknowledgements: StoredAcknowledgement[];
  annual?: { state: PeriodState; reconciledAt: string | null; changedAt: string | null } | null;
}): DownloadAssessment {
  const review = reconcileAcknowledgements(input.acknowledgements, input.review);
  return {
    blocked: input.blocking.length > 0,
    blockKeys: input.blocking.map((i) => i.key),
    needsAcknowledgement: review.needsAcknowledgement,
    invalidated: review.invalidated,
    annualCurrent: input.annual === undefined ? null : annualReadinessIsCurrent(input.annual),
  };
}
