// node scripts/store-engine-parity.mjs --base https://staging.khatario.com --demos --report tmp-qa/engine-migration/report.json
//
// Store theme engine M4 (D36): screenshots each store's old storefront and its engine theme side by side at phone and
// desktop width, and writes <out>/<label>/{old,new}-{390,1280}.png plus <out>/index.html. No pixel diff.
//
// Options:
//   --base <url>      required: http://localhost:<port>, http://127.0.0.1:<port> or https://staging.khatario.com only
//                     (never production; AGENTS.md)
//   --demos           the four theme demo stores: / (old) and /?engine=1 (new)
//   --report <path>   a migration report (scripts/migrate-store-themes.mjs --preview-links): each migrated store with a
//                     preview_path, at / (old; only while its store_engine is off) and that preview path (new)
//   --only <sub>      just this store subdomain
//   --out <dir>       output folder (default tmp-qa/engine-parity; tmp-qa/ is never committed)
//
// A failed shot is a red "failed" cell in the page and does not stop the run; the run exits 0. Bad arguments exit 2.
// Preview share tokens are never printed or written to index.html.
import { createRequire } from 'module';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = 'tmp-qa/engine-parity';
const SHOT_HEIGHT = 900;
const NAV_TIMEOUT_MS = 60_000;
const SETTLE_MS = 1000;

function refuse(message) {
  console.error(`Refused: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { base: null, report: null, demos: false, only: null, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) refuse(`${arg} needs a value.`);
      return v;
    };
    switch (arg) {
      case '--base':
        opts.base = value();
        break;
      case '--report':
        opts.report = value();
        break;
      case '--demos':
        opts.demos = true;
        break;
      case '--only':
        opts.only = value();
        break;
      case '--out':
        opts.out = value();
        break;
      default:
        refuse(`unknown argument ${JSON.stringify(arg)}.`);
    }
  }
  if (!opts.base) refuse('--base is required.');
  if (!opts.demos && !opts.report) refuse('choose --demos, --report <path> or both.');
  return opts;
}

/** A URL for the console: a preview share token is replaced by `…`. */
function shown(url) {
  return url.replace(/([?&]pt=)[^&#]*/g, '$1…');
}

const opts = parseArgs(process.argv.slice(2));

process.env.TS_NODE_PROJECT = join(ROOT, 'tsconfig.worker.json');
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
const require = createRequire(import.meta.url);
require('ts-node/register');
require('tsconfig-paths/register');
const { PARITY_WIDTHS, parityHtml, parityTargets } = require(join(ROOT, 'lib/store/engine/parity.ts'));

let report;
if (opts.report) {
  try {
    report = JSON.parse(readFileSync(resolve(process.cwd(), opts.report), 'utf8'));
  } catch (err) {
    refuse(`could not read the report ${JSON.stringify(opts.report)}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!report || !Array.isArray(report.rows)) refuse('the report has no "rows" list.');
}

let targets;
try {
  targets = parityTargets({ base: opts.base, demos: opts.demos, report, only: opts.only });
} catch (err) {
  refuse(err instanceof Error ? err.message : String(err));
}

const outDir = resolve(process.cwd(), opts.out);
mkdirSync(outDir, { recursive: true });
if (targets.length === 0) console.log('No targets: nothing to screenshot.');

const { chromium } = require('@playwright/test');
const browser = await chromium.launch();
const rows = [];
try {
  for (const target of targets) {
    console.log(`${target.label}\n  old ${shown(target.oldUrl)}\n  new ${shown(target.newUrl)}`);
    mkdirSync(join(outDir, target.label), { recursive: true });
    const shots = [];
    for (const width of PARITY_WIDTHS) {
      const shot = { width, old: '', new: '' };
      for (const side of ['old', 'new']) {
        const rel = `${target.label}/${side}-${width}.png`;
        const context = await browser.newContext({ viewport: { width, height: SHOT_HEIGHT }, reducedMotion: 'reduce' });
        try {
          const page = await context.newPage();
          await page.goto(side === 'old' ? target.oldUrl : target.newUrl, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
          await page.waitForTimeout(SETTLE_MS);
          await page.screenshot({ path: join(outDir, rel), fullPage: true });
          shot[side] = rel;
        } catch (err) {
          console.log(`  failed ${side} ${width}px: ${shown(err instanceof Error ? err.message.split('\n')[0] : String(err))}`);
        } finally {
          await context.close();
        }
      }
      shots.push(shot);
    }
    rows.push({ ...target, shots });
  }
} finally {
  await browser.close();
}

writeFileSync(join(outDir, 'index.html'), parityHtml(rows));
const failed = rows.reduce((n, r) => n + r.shots.reduce((m, s) => m + (s.old ? 0 : 1) + (s.new ? 0 : 1), 0), 0);
console.log(`Done: ${rows.length} store${rows.length === 1 ? '' : 's'}, ${failed} failed shot${failed === 1 ? '' : 's'}.`);
console.log(`Report: ${join(opts.out, 'index.html')}`);
process.exit(0);
