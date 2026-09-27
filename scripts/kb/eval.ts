/**
 * Retrieval quality check against the indexed knowledge base.
 *
 *   npm run kb:eval                    # fails (exit 1) when hit rate < KB_EVAL_MIN_HIT_RATE (default 0.85)
 *   npm run kb:eval -- --rewrite       # run each question through the query-rewrite step first
 *   npm run kb:eval -- --verbose
 *
 * Runs retrieval only; no answer generation, so it costs at most one embedding call per question.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { closePool, queryRows } from '@/lib/db';
import { retrieve } from '@/lib/rag/retrieve';
import { rewriteQuery } from '@/lib/rag/rewrite';
import type { Audience } from '@/lib/rag/types';

interface EvalCase {
  q: string;
  audience: Audience;
  expect: string[];
  forbid: string[];
  confident?: boolean;
}

function parseList(raw: string): string[] {
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseEvalSet(source: string): EvalCase[] {
  const cases: EvalCase[] = [];
  let current: EvalCase | null = null;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const start = /^-\s+q:\s*(.+)$/.exec(line);
    if (start) {
      current = { q: start[1].trim(), audience: 'prospect', expect: [], forbid: [] };
      cases.push(current);
      continue;
    }
    const kv = /^\s+(expect|forbid|audience|confident):\s*(.+)$/.exec(line);
    if (!kv || !current) continue;
    const [, key, value] = kv;
    if (key === 'expect') current.expect = parseList(value);
    else if (key === 'forbid') current.forbid = parseList(value);
    else if (key === 'audience') current.audience = value.trim() as Audience;
    else current.confident = value.trim() === 'true';
  }
  return cases;
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  const useRewrite = process.argv.includes('--rewrite');
  const minHitRate = Number(process.env.KB_EVAL_MIN_HIT_RATE ?? 0.85);
  const cases = parseEvalSet(readFileSync(join(process.cwd(), 'tests', 'rag', 'eval-set.yml'), 'utf8'));

  const docKeys = new Map(
    (await queryRows<{ id: string; doc_key: string }>(`SELECT id, doc_key FROM kb_documents`)).map((r) => [r.id, r.doc_key]),
  );
  if (!docKeys.size) {
    console.error('[kb:eval] The index is empty. Run `npm run kb:reindex` first.');
    process.exit(1);
  }

  let recallCases = 0;
  let hits = 0;
  let reciprocalRankSum = 0;
  const failures: string[] = [];

  for (const c of cases) {
    const rewritten = useRewrite ? await rewriteQuery(c.q) : null;
    const result = await retrieve({
      scope: { audience: c.audience },
      searchQuery: rewritten?.searchQuery ?? c.q,
      originalQuery: c.q,
    });
    const keys = result.chunks.map((ch) => docKeys.get(ch.documentId) ?? '?');
    const problems: string[] = [];

    if (c.expect.length) {
      recallCases++;
      const rank = keys.findIndex((k) => c.expect.includes(k));
      if (rank >= 0) {
        hits++;
        reciprocalRankSum += 1 / (rank + 1);
      } else {
        problems.push(`expected one of [${c.expect.join(', ')}]`);
      }
      if (!result.confident) problems.push('not confident');
    }
    if (c.confident === false && result.confident) problems.push('answered confidently but should not');
    const leaked = keys.filter((k) => c.forbid.includes(k));
    if (leaked.length) problems.push(`returned forbidden [${Array.from(new Set(leaked)).join(', ')}]`);

    if (problems.length) failures.push(`  ✗ [${c.audience}] ${c.q}\n      ${problems.join('; ')}\n      got: ${keys.join(', ') || '(nothing)'}`);
    if (verbose) {
      console.log(`${problems.length ? '✗' : '✓'} [${c.audience}] ${c.q}`);
      console.log(`    ${keys.join(', ')}  coverage=${result.diagnostics.termCoverage} vector=${result.diagnostics.topVectorSimilarity ?? '-'}`);
    }
  }

  const hitRate = recallCases ? hits / recallCases : 1;
  const mrr = recallCases ? reciprocalRankSum / recallCases : 1;
  const hardFailures = failures.filter((f) => f.includes('forbidden') || f.includes('should not'));
  console.log(`\nRetrieval eval: ${cases.length} cases, hit rate ${(hitRate * 100).toFixed(1)}%, MRR ${mrr.toFixed(3)}`);
  if (failures.length) console.log(`\nFailures:\n${failures.join('\n')}`);
  await closePool();
  if (hitRate < minHitRate || hardFailures.length) {
    console.error(`\n[kb:eval] FAILED (minimum hit rate ${(minHitRate * 100).toFixed(0)}%, isolation/out-of-scope failures: ${hardFailures.length})`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('[kb:eval] failed:', err instanceof Error ? err.message : err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
}
