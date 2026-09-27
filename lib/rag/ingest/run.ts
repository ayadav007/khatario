import { indexSource, removeStaleSources, type IndexOptions, type SourceIndexResult } from './indexer';
import { KnowledgeFileError, listKnowledgeFiles, loadMarkdownSource } from './markdown-source';
import { loadPlansSource, PLANS_LOCATOR } from './plans-source';
import { loadMarketingSources } from './marketing-source';

export type ReindexTarget = 'markdown' | 'plans' | 'marketing' | 'all';

export interface ReindexRequest extends IndexOptions {
  target: ReindexTarget;
  /** Limit to one markdown file (relative to knowledge/) or one marketing page slug. */
  locator?: string;
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

export async function reindex(req: ReindexRequest): Promise<ReindexReport> {
  const report: ReindexReport = { results: [], removed: [], errors: [] };
  if (req.target === 'markdown' || req.target === 'all') await reindexMarkdown(req, report);
  if (req.target === 'plans' || req.target === 'all') await reindexPlans(req, report);
  if (req.target === 'marketing' || req.target === 'all') await reindexMarketing(req, report);
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
