import { queryRows } from '@/lib/db';
import { indexSource, removeStaleSources, removeStaleTenantSources, type IndexOptions, type SourceIndexResult } from './indexer';
import { KnowledgeFileError, listKnowledgeFiles, loadMarkdownSource } from './markdown-source';
import { loadPlansSource, PLANS_LOCATOR } from './plans-source';
import { loadMarketingSources } from './marketing-source';
import {
  loadTenantCatalogSource,
  loadTenantFaqSource,
  loadTenantFileSource,
  loadTenantPolicySource,
  loadTenantTextSource,
} from './tenant-sources';
import { TENANT_SOURCE_KINDS } from '../types';

/** `tenant` needs `businessId`; `all` covers Khatario's own knowledge only. */
export type ReindexTarget = 'markdown' | 'plans' | 'marketing' | 'tenant' | 'all';

export interface ReindexRequest extends IndexOptions {
  target: ReindexTarget;
  /** Limit to one markdown file (relative to knowledge/) or one marketing page slug. */
  locator?: string;
  businessId?: string;
}

export interface ReindexReport {
  results: SourceIndexResult[];
  removed: string[];
  errors: string[];
}

async function reindexMarkdown(req: ReindexRequest, report: ReindexReport) {
  const files = listKnowledgeFiles();
  const locators: string[] = [];
  for (const file of files) {
    let source;
    try {
      source = loadMarkdownSource(file);
    } catch (err) {
      const message = err instanceof KnowledgeFileError ? err.message : String(err);
      report.errors.push(message);
      continue;
    }
    locators.push(source.locator);
    if (req.locator && req.locator !== source.locator) continue;
    report.results.push(await indexSource(source, req));
  }
  // Only prune when the whole folder loaded; a parse error must not delete a live document.
  if (!req.locator && report.errors.length === 0) {
    report.removed.push(...(await removeStaleSources('markdown', locators, req.dryRun)).map((l) => `markdown:${l}`));
  }
}

async function reindexPlans(req: ReindexRequest, report: ReindexReport) {
  try {
    report.results.push(await indexSource(await loadPlansSource(), req));
  } catch (err) {
    report.errors.push(`plans: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!req.dryRun) await removeStaleSources('plans', [PLANS_LOCATOR]);
}

async function reindexMarketing(req: ReindexRequest, report: ReindexReport) {
  try {
    const sources = await loadMarketingSources(req.target === 'marketing' ? req.locator : undefined);
    for (const source of sources) report.results.push(await indexSource(source, req));
    if (!req.locator) {
      report.removed.push(
        ...(await removeStaleSources('marketing_page', sources.map((s) => s.locator), req.dryRun)).map((l) => `marketing:${l}`),
      );
    }
  } catch (err) {
    report.errors.push(`marketing: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A shop's catalog and policies for its WhatsApp customer bot. Keyword-only in v1 (no embedding quota). */
async function reindexTenant(req: ReindexRequest, report: ReindexReport) {
  const businessId = req.businessId;
  if (!businessId) {
    report.errors.push('tenant: businessId is required');
    return;
  }
  const opts = { ...req, keywordOnly: true };
  const live: string[] = [];
  let loadFailed = false;
  for (const [label, load] of [
    ['catalog', loadTenantCatalogSource],
    ['policies', loadTenantPolicySource],
    ['faqs', loadTenantFaqSource],
    ['notes', loadTenantTextSource],
    ['files', loadTenantFileSource],
  ] as const) {
    try {
      const source = await load(businessId);
      if (!source.documents.length) continue;
      live.push(`${source.kind}:${source.locator}`);
      report.results.push(await indexSource(source, opts));
    } catch (err) {
      loadFailed = true;
      report.errors.push(`tenant ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // An empty catalog (all items hidden from the store) removes the old chunks; a load error keeps them.
  if (!loadFailed) {
    report.removed.push(...(await removeStaleTenantSources(businessId, [...TENANT_SOURCE_KINDS], live, req.dryRun)));
  }
}

/** Businesses whose shop knowledge is already indexed: the nightly safety net refreshes only these. */
export async function indexedTenantBusinessIds(): Promise<string[]> {
  const rows = await queryRows<{ business_id: string }>(
    `SELECT DISTINCT business_id FROM kb_sources WHERE business_id IS NOT NULL AND kind = ANY($1::text[])`,
    [[...TENANT_SOURCE_KINDS]],
  ).catch(() => []);
  return rows.map((r) => r.business_id);
}

export async function reindex(req: ReindexRequest): Promise<ReindexReport> {
  const report: ReindexReport = { results: [], removed: [], errors: [] };
  if (req.target === 'markdown' || req.target === 'all') await reindexMarkdown(req, report);
  if (req.target === 'plans' || req.target === 'all') await reindexPlans(req, report);
  if (req.target === 'marketing' || req.target === 'all') await reindexMarketing(req, report);
  if (req.target === 'tenant') await reindexTenant(req, report);
  for (const r of report.results) {
    if (r.status === 'error' && r.error) report.errors.push(`${r.kind}:${r.locator}: ${r.error}`);
  }
  return report;
}

export function summarizeReport(report: ReindexReport): string {
  const count = (s: SourceIndexResult['status']) => report.results.filter((r) => r.status === s).length;
  const embedded = report.results.reduce((n, r) => n + r.embedded, 0);
  const reused = report.results.reduce((n, r) => n + r.reusedEmbeddings, 0);
  return [
    `sources: ${report.results.length} (indexed ${count('indexed')}, unchanged ${count('skipped')}, errors ${count('error')}, dry-run ${count('dry_run')})`,
    `chunks embedded: ${embedded}, embeddings reused: ${reused}`,
    report.removed.length ? `removed: ${report.removed.join(', ')}` : 'removed: none',
    ...report.errors.map((e) => `error: ${e}`),
  ].join('\n');
}
