/**
 * Rebuild the assistant knowledge index.
 *
 *   npm run kb:reindex                         # everything (markdown, plans, marketing pages)
 *   npm run kb:reindex -- --source=markdown    # only knowledge/*.md (used by deploy)
 *   npm run kb:reindex -- --source=plans
 *   npm run kb:reindex -- --source=marketing --locator=home
 *   npm run kb:reindex -- --force              # re-embed even when hashes match
 *   npm run kb:reindex -- --dry-run
 */
import { closePool } from '@/lib/db';
import { reindex, summarizeReport, type ReindexTarget } from '@/lib/rag/ingest/run';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  const source = (arg('source') ?? 'all') as ReindexTarget;
  if (!['markdown', 'plans', 'marketing', 'all'].includes(source)) {
    console.error(`Unknown --source=${source}`);
    process.exit(2);
  }
  const report = await reindex({
    target: source,
    locator: arg('locator'),
    force: process.argv.includes('--force'),
    dryRun: process.argv.includes('--dry-run'),
  });
  console.log(summarizeReport(report));
  await closePool();
  if (report.errors.length && !process.argv.includes('--allow-errors')) process.exit(1);
}

main().catch(async (err) => {
  console.error('[kb:reindex] failed:', err instanceof Error ? err.message : err);
  await closePool().catch(() => undefined);
  process.exit(1);
});
