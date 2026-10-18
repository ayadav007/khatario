import type { Pool, PoolClient } from 'pg';
import { approvedRcmRules, type RcmRule } from '@/lib/gst/rcm-rules';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

type ApprovedRow = {
  id: string;
  catalogue_version: number;
  effective_from: string;
  effective_to: string | null;
  supplier_type: RcmRule['supplierType'];
  sac_prefix: string | null;
  hsn_prefix: string | null;
  expense_category: string | null;
  source_citation: string;
  review_only: boolean;
  status: 'candidate' | 'approved';
  recipient_class: string | null;
  turnover_min: string | null;
  turnover_max: string | null;
  exclusions: string[] | null;
};

const APPROVED_RCM_SQL = `
  SELECT id, catalogue_version, to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
         to_char(effective_to, 'YYYY-MM-DD') AS effective_to, supplier_type, sac_prefix, hsn_prefix,
         expense_category, source_citation, review_only, status, recipient_class,
         turnover_min, turnover_max, exclusions
    FROM gst_rcm_rules
   WHERE status = 'approved'`;

function toRule(row: ApprovedRow): RcmRule {
  return {
    id: row.id,
    catalogueVersion: row.catalogue_version,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    supplierType: row.supplier_type,
    sacPrefix: row.sac_prefix,
    hsnPrefix: row.hsn_prefix,
    expenseCategory: row.expense_category,
    sourceCitation: row.source_citation,
    reviewOnly: row.review_only,
    status: row.status,
    recipientClass: row.recipient_class,
    turnoverMin: row.turnover_min == null ? null : Number(row.turnover_min),
    turnoverMax: row.turnover_max == null ? null : Number(row.turnover_max),
    exclusions: Array.isArray(row.exclusions) ? row.exclusions : [],
  };
}

/** Approved rows only. Candidate rules are not detection. */
export async function loadApprovedRcmRules(db: Queryable): Promise<RcmRule[]> {
  const ruleRows = await db.query<ApprovedRow>(APPROVED_RCM_SQL);
  return approvedRcmRules(ruleRows.rows).map(toRule);
}

export async function countApprovedRcmRules(db: Queryable): Promise<number> {
  return (await loadApprovedRcmRules(db)).length;
}
