/**
 * Warns when TSX uses arbitrary Tailwind font sizes (text-[Npx]) outside allowlisted paths.
 * Run: node scripts/check-arbitrary-font-sizes.mjs
 * Strict mode (CI): node scripts/check-arbitrary-font-sizes.mjs --strict
 */
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);
const ARBITRARY_FONT = /text-\[\d+(?:\.\d+)?px\]/g;

/** Paths that intentionally mimic external UIs or print/PDF pixel layouts */
const ALLOWLIST = [
  'components/whatsapp/conversations/',
  'components/invoices/extraction-debug/',
  'components/labels/',
  'components/templates/TemplatePreview',
  'components/admin/PromotionFormPreview',
  'components/marketing/',
  'app/book-demo/',
];

const strict = process.argv.includes('--strict');

function walk(dir, out = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    if (SKIP_DIRS.has(name)) continue;
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function isAllowlisted(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  return ALLOWLIST.some((prefix) => normalized.includes(prefix));
}

const roots = ['app', 'components'].map((r) => join(process.cwd(), r));
const files = [];
for (const root of roots) {
  files.push(...walk(root));
}

const violations = [];
for (const file of files) {
  const rel = relative(process.cwd(), file).replace(/\\/g, '/');
  if (isAllowlisted(rel)) continue;
  const content = readFileSync(file, 'utf8');
  const matches = content.match(ARBITRARY_FONT);
  if (matches?.length) {
    violations.push({ file: rel, count: matches.length, samples: [...new Set(matches)].slice(0, 5) });
  }
}

if (violations.length) {
  const total = violations.reduce((n, v) => n + v.count, 0);
  console.warn(
    `check-arbitrary-font-sizes: ${total} arbitrary text-[Npx] in ${violations.length} files (use text-2xs, text-caption, type-* tokens)\n`,
  );
  for (const v of violations.slice(0, 25)) {
    console.warn(`  ${v.file} (${v.count}): ${v.samples.join(', ')}`);
  }
  if (violations.length > 25) {
    console.warn(`  … and ${violations.length - 25} more files`);
  }
  console.warn('\nRun: node scripts/migrate-arbitrary-font-sizes.mjs --dry-run');
  if (strict) process.exit(1);
} else {
  console.log('check-arbitrary-font-sizes: OK (no arbitrary text-[Npx] outside allowlist)');
}
