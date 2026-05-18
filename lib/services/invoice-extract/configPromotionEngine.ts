/**
 * Versioned promotion workflow for adaptive config patches — benchmarks first, manual approval, immutable release snapshot.
 */

import { query as dbQuery, queryOne } from '@/lib/db';
import type { AdaptiveProposalStatus } from './adaptiveConfigEngine';
import {
  getAdaptiveProposal,
  updateAdaptiveProposalBenchmarkSummary,
} from './adaptiveConfigEngine';
import { runGoldenBenchmarkSuiteFromDisk } from './invoiceBenchmarkRunner';

export interface PromotionBenchmarkOptions {
  goldenRootDir: string;
  /** Mean composite score threshold [0,1] — default 0.98 */
  passThreshold?: number;
}

export async function runBenchmarkGateForProposal(
  proposalId: string,
  options: PromotionBenchmarkOptions,
): Promise<{ passed: boolean; summary: Record<string, unknown> }> {
  const agg = runGoldenBenchmarkSuiteFromDisk(options.goldenRootDir);
  const threshold = options.passThreshold ?? 0.98;
  const passed = agg.mean_score >= threshold && agg.failed_scenarios.length === 0;
  const summary: Record<string, unknown> = {
    mean_score: agg.mean_score,
    failed_scenarios: agg.failed_scenarios,
    scenario_count: agg.scenarios.length,
    threshold,
    golden_root: options.goldenRootDir,
  };
  const status: AdaptiveProposalStatus = passed ? 'benchmark_passed' : 'benchmark_failed';
  await updateAdaptiveProposalBenchmarkSummary(proposalId, summary, !passed, status);
  return { passed, summary };
}

export async function approveAdaptiveProposal(proposalId: string, approvedByUserId: string): Promise<boolean> {
  const proposal = await getAdaptiveProposal(proposalId);
  if (!proposal || proposal.status !== 'benchmark_passed') return false;
  await dbQuery(
    `UPDATE adaptive_config_proposals
     SET status = 'approved',
         approved_by = $2,
         approved_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [proposalId, approvedByUserId]
  );
  return true;
}

export async function rejectAdaptiveProposal(proposalId: string): Promise<void> {
  await dbQuery(
    `UPDATE adaptive_config_proposals SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [proposalId]
  );
}

export async function promoteAdaptiveProposal(params: {
  proposalId: string;
  promotedByUserId: string;
  releaseVersion?: string;
}): Promise<{ release_id: string | null }> {
  const proposal = await getAdaptiveProposal(params.proposalId);
  if (!proposal || proposal.status !== 'approved') return { release_id: null };

  const release_version =
    params.releaseVersion ?? `rel_${proposal.proposal_version}_${Date.now().toString(36)}`;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO adaptive_config_releases (
      business_id, release_version, proposal_id, config_snapshot, promoted_by
    ) VALUES ($1,$2,$3,$4::jsonb,$5)
    RETURNING id`,
    [
      proposal.business_id,
      release_version,
      proposal.id,
      JSON.stringify({
        proposal_version: proposal.proposal_version,
        patch: proposal.config_patch,
        benchmark_summary: proposal.benchmark_summary,
      }),
      params.promotedByUserId,
    ]
  );

  await dbQuery(
    `UPDATE adaptive_config_proposals SET status = 'promoted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [params.proposalId]
  );

  return { release_id: row?.id ?? null };
}
