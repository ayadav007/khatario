import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { assertGstr2bApiAccess } from '@/lib/gst/gstr2b-route-guard';
import { reconcileAcknowledgements, type AckIssue, type StoredAcknowledgement, type TaxHeads } from '@/lib/gst/acknowledgements';
import { assessDownload, gstr1BlockingIssues, periodIssue, type PortalRow } from '@/lib/gst/return-readiness';
import { collectHeadDifferenceIssues } from '@/lib/gst/reconciliation-ack-issues';
import { runGstr13bReconciliation } from '@/lib/gst/gstr1-3b-reconciliation';
import { financialYearKey, markReturnReconciled, type PeriodState, type ReturnKind } from '@/lib/gst/period-freshness';

export const dynamic = 'force-dynamic';

const KINDS = new Set<ReturnKind>(['gstr1', 'gstr3b', 'gstr2b', 'gstr9']);

function monthBounds(period: string): [string, string] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return [`${period}-01`, next];
}

function fyBounds(key: string): [string, string] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const start = Number(m[1]);
  return [`${start}-04-01`, `${start + 1}-04-01`];
}

async function loadAcks(businessId: string, kind: string, periodKey: string): Promise<StoredAcknowledgement[]> {
  const rows = await getPool().query<{
    id: string; snapshot_id: string; issue_key: string; facts: AckIssue['facts']; amounts: TaxHeads;
    user_id: string; acknowledged_at: string; invalidated_at: string | null;
  }>(
    `SELECT id, snapshot_id, issue_key, facts, amounts, user_id,
            acknowledged_at::text, invalidated_at::text
       FROM gst_return_acknowledgements
      WHERE business_id = $1 AND kind = $2 AND period_key = $3`,
    [businessId, kind, periodKey]
  );
  return rows.rows.map((row) => ({
    id: row.id,
    issueKey: row.issue_key,
    snapshotId: row.snapshot_id,
    facts: row.facts || {},
    amounts: row.amounts || { igst: 0, cgst: 0, sgst: 0, cess: 0 },
    userId: row.user_id,
    acknowledgedAt: row.acknowledged_at,
    invalidatedAt: row.invalidated_at,
  }));
}

export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams;
    const kind = params.get('kind') as ReturnKind | null;
    const periodKey = params.get('period') || '';
    if (!kind || !KINDS.has(kind) || !periodKey) {
      return NextResponse.json({ error: 'kind and period are required' }, { status: 400 });
    }
    const access = await assertGstr2bApiAccess(request, params.get('business_id'), 'read');
    if (!access.ok) return access.response;

    const pool = getPool();
    const status = await pool.query<{ state: PeriodState; changed_at: string | null; reconciled_at: string | null }>(
      `SELECT state, changed_at::text, reconciled_at::text
         FROM gst_period_status
        WHERE business_id = $1 AND kind = $2 AND period_key = $3`,
      [access.businessId, kind, periodKey]
    );
    const row = status.rows[0] ?? null;
    const bounds = kind === 'gstr9' ? fyBounds(periodKey) : monthBounds(periodKey);
    let blocking: AckIssue[] = [];
    if (bounds && (kind === 'gstr1' || kind === 'gstr9')) {
      const docs = await pool.query<{
        id: string; invoice_number: string | null; invoice_date: string | null;
        place_of_supply_state_code: string | null; customer_gstin: string | null;
      }>(
        `SELECT id, invoice_number, to_char(invoice_date, 'YYYY-MM-DD') AS invoice_date,
                place_of_supply_state_code, customer_gstin
           FROM invoices
          WHERE business_id = $1 AND deleted_at IS NULL AND status = 'final'
            AND invoice_date >= $2::date AND invoice_date < $3::date
            AND COALESCE(TRIM(customer_gstin), '') <> ''`,
        [access.businessId, bounds[0], bounds[1]]
      );
      const portal: PortalRow[] = docs.rows.map((doc) => ({
        id: doc.id,
        invoiceNumber: doc.invoice_number,
        invoiceDate: doc.invoice_date,
        placeOfSupply: doc.place_of_supply_state_code,
        gstin: doc.customer_gstin,
        included: true,
      }));
      blocking = gstr1BlockingIssues(portal);
    }

    const review: AckIssue[] = [];
    const freshness = row?.state ?? 'not_checked';
    const period = periodIssue(kind, periodKey, freshness);
    if (period && freshness !== 'ready') review.push(period);
    if (kind === 'gstr1' || kind === 'gstr3b' || kind === 'gstr9') {
      const branches = await pool.query<{ id: string }>(
        `SELECT id FROM branches
          WHERE business_id = $1 AND COALESCE(is_active, true) = true
          ORDER BY is_primary DESC NULLS LAST, created_at`,
        [access.businessId]
      );
      review.push(
        ...(await collectHeadDifferenceIssues({
          kind,
          periodKey,
          branches: branches.rows.map((branch) => branch.id),
          run: async (period, branchId) => {
            const result = await runGstr13bReconciliation({
              businessId: access.businessId,
              gstPeriod: period,
              branchId,
              mode: 'live_vs_live',
            });
            return result.head_wise;
          },
        }))
      );
    }

    const acks = await loadAcks(access.businessId, kind, periodKey);
    const compared = reconcileAcknowledgements(acks, review);
    for (const ack of compared.invalidated) {
      await pool.query(
        `UPDATE gst_return_acknowledgements SET invalidated_at = clock_timestamp()
          WHERE id = $1 AND invalidated_at IS NULL`,
        [ack.id]
      );
    }
    const assessment = assessDownload({
      blocking,
      review,
      acknowledgements: acks,
      annual: kind === 'gstr9'
        ? { state: freshness, reconciledAt: row?.reconciled_at ?? null, changedAt: row?.changed_at ?? null }
        : undefined,
    });

    const snapshotId = [
      `${kind}:${periodKey}:${freshness}`,
      ...review.map(
        (issue) =>
          `${issue.key}:${issue.amounts.igst},${issue.amounts.cgst},${issue.amounts.sgst},${issue.amounts.cess}`
      ),
    ].join('|');
    const clear = blocking.length === 0 && assessment.needsAcknowledgement.length === 0;
    if (clear) {
      await markReturnReconciled(pool, access.businessId, kind, periodKey);
    }

    return NextResponse.json({
      kind,
      period: periodKey,
      financialYear: kind === 'gstr9' ? periodKey : financialYearKey(`${periodKey}-01`),
      freshness: clear ? 'ready' : freshness,
      annualCurrent: kind === 'gstr9' ? clear : null,
      blocked: assessment.blocked,
      blockKeys: assessment.blockKeys,
      needsAcknowledgement: assessment.needsAcknowledgement,
      invalidatedIssueKeys: compared.invalidated.map((ack) => ack.issueKey),
      snapshotId,
      filingNote: 'This file is for upload. Filing is recorded only by Mark as filed.',
    });
  } catch (error) {
    console.error('Return readiness failed:', error);
    return NextResponse.json({ error: 'Failed to check return readiness' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const kind = body.kind as ReturnKind;
    const periodKey = String(body.period || '');
    const snapshotId = String(body.snapshotId || '');
    const issues = Array.isArray(body.issues) ? body.issues as AckIssue[] : [];
    if (!KINDS.has(kind) || !periodKey || !snapshotId || issues.length === 0) {
      return NextResponse.json({ error: 'kind, period, snapshotId, and issues are required' }, { status: 400 });
    }
    const access = await assertGstr2bApiAccess(request, body.business_id, 'create');
    if (!access.ok) return access.response;
    const pool = getPool();
    for (const issue of issues) {
      if (!issue?.key || !issue.amounts) continue;
      await pool.query(
        `INSERT INTO gst_return_acknowledgements
           (business_id, kind, period_key, snapshot_id, issue_key, facts, amounts, user_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
        [
          access.businessId,
          kind,
          periodKey,
          snapshotId,
          issue.key,
          JSON.stringify(issue.facts || {}),
          JSON.stringify(issue.amounts),
          access.userId,
        ]
      );
    }
    return NextResponse.json({ acknowledged: true });
  } catch (error) {
    console.error('Acknowledgement failed:', error);
    return NextResponse.json({ error: 'Failed to store acknowledgement' }, { status: 500 });
  }
}
