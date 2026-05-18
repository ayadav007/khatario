/**
 * Proposes deterministic configuration patches only — stored as draft rows for human review + benchmark gates.
 * Never writes runtime globals or mutates parsers directly.
 */

import { query as dbQuery, queryOne } from '@/lib/db';
import type { ParserVersionMetadata } from './parserVersion';
import { getParserVersionMetadata } from './parserVersion';

export type AdaptiveProposalStatus =
  | 'draft'
  | 'benchmark_pending'
  | 'benchmark_passed'
  | 'benchmark_failed'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'promoted';

import type { OptimizationWeights } from './optimizationScorer';
import type { SemanticValidationOptions } from './semanticLineValidator';
import type { NumericRepairSearchOptions } from './numericRepairSearch';

/** Structured patch types reviewers can inspect line-by-line */
export interface AdaptiveConfigPatch {
  header_synonyms?: Record<string, string[]>;
  supplier_aliases?: Record<string, string>;
  thresholds?: Record<string, number>;
  gst_heuristics?: Record<string, unknown>;
  layout_preferences?: Record<string, unknown>;
  /** When non-empty, patch applies only if supplier GSTIN hash matches one entry. */
  supplier_hash_allowlist?: string[];
  /** When non-empty, patch applies only if layout fingerprint matches one entry. */
  layout_fingerprint_allowlist?: string[];
  optimization_weights?: Partial<OptimizationWeights>;
  semantic_validation?: SemanticValidationOptions;
  numeric_repair_search?: Partial<NumericRepairSearchOptions>;
  preferred_price_mode?: 'inclusive' | 'exclusive';
}

export interface AdaptiveProposalRecord {
  id: string;
  business_id: string | null;
  proposal_version: string;
  status: AdaptiveProposalStatus;
  config_patch: AdaptiveConfigPatch;
  rationale: string | null;
  benchmark_summary: Record<string, unknown>;
  regression_detected: boolean;
}

function proposalVersionSlug(scope: string): string {
  const t = Date.now().toString(36);
  return `${scope}_${t}`;
}

export async function insertAdaptiveConfigProposal(row: {
  businessId?: string | null;
  patch: AdaptiveConfigPatch;
  rationale?: string;
  proposalVersion?: string;
  parserHint?: ParserVersionMetadata;
}): Promise<string | null> {
  try {
    const proposal_version =
      row.proposalVersion ?? proposalVersionSlug(row.businessId ? `biz_${row.businessId.slice(0, 8)}` : 'platform');
    const parserHint = row.parserHint ?? getParserVersionMetadata();
    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO adaptive_config_proposals (
        business_id, proposal_version, status, config_patch, rationale, benchmark_summary, regression_detected
      ) VALUES (
        $1, $2, 'draft', $3::jsonb, $4, $5::jsonb, false
      )
      RETURNING id`,
      [
        row.businessId ?? null,
        proposal_version,
        JSON.stringify({
          ...row.patch,
          _parser_versions_when_proposed: parserHint,
        }),
        row.rationale ?? null,
        JSON.stringify({}),
      ]
    );
    return inserted?.id ?? null;
  } catch (e) {
    console.warn('[adaptive-config] insert proposal failed:', e);
    return null;
  }
}

export async function getAdaptiveProposal(id: string): Promise<AdaptiveProposalRecord | null> {
  try {
    const row = await queryOne<{
      id: string;
      business_id: string | null;
      proposal_version: string;
      status: AdaptiveProposalStatus;
      config_patch: AdaptiveConfigPatch;
      rationale: string | null;
      benchmark_summary: Record<string, unknown>;
      regression_detected: boolean;
    }>(
      `SELECT id, business_id, proposal_version, status,
              config_patch::jsonb AS config_patch,
              rationale,
              benchmark_summary::jsonb AS benchmark_summary,
              regression_detected
       FROM adaptive_config_proposals WHERE id = $1`,
      [id]
    );
    if (!row) return null;
    return {
      id: row.id,
      business_id: row.business_id,
      proposal_version: row.proposal_version,
      status: row.status,
      config_patch: row.config_patch,
      rationale: row.rationale,
      benchmark_summary: row.benchmark_summary ?? {},
      regression_detected: row.regression_detected,
    };
  } catch {
    return null;
  }
}

export async function updateAdaptiveProposalBenchmarkSummary(
  id: string,
  summary: Record<string, unknown>,
  regressionDetected: boolean,
  status: AdaptiveProposalStatus,
): Promise<void> {
  await dbQuery(
    `UPDATE adaptive_config_proposals
     SET benchmark_summary = $2::jsonb,
         regression_detected = $3,
         status = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, JSON.stringify(summary), regressionDetected, status]
  );
}
