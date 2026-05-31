/**
 * Replaces common text-[Npx] utilities with semantic Tailwind tokens.
 * Run: node scripts/migrate-arbitrary-font-sizes.mjs --dry-run
 * Apply: node scripts/migrate-arbitrary-font-sizes.mjs
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

const REPLACEMENTS = [
  ['text-[9px]', 'text-2xs'],
  ['text-[10px]', 'text-2xs'],
  ['text-[11px]', 'text-caption'],
  ['text-[12px]', 'text-xs'],
  ['text-[12.8px]', 'text-xs'],
  ['text-[13px]', 'text-sm'],
  ['text-[14px]', 'text-sm'],
  ['text-[14.2px]', 'text-sm'],
  ['text-[15px]', 'text-base'],
  ['text-[16px]', 'text-base'],
  ['text-[18px]', 'text-lg'],
  ['text-[20px]', 'text-xl'],
  ['text-[21px]', 'text-xl'],
  ['text-[24px]', 'text-2xl'],
  ['text-[25.6px]', 'text-2xl'],
  ['text-[30px]', 'text-3xl'],
  ['text-[17px]', 'text-lg'],
  ['text-[28px]', 'text-display'],
  ['text-[36px]', 'text-display-lg'],
  ['text-[32px]', 'text-display'],
];

const ALLOWLIST = [
  'components/whatsapp/conversations/',
  'components/invoices/extraction-debug/',
  'components/labels/',
  'components/marketing/',
];

const dryRun = process.argv.includes('--dry-run');

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

let changedFiles = 0;
let totalReplacements = 0;

for (const file of files) {
  const rel = relative(process.cwd(), file).replace(/\\/g, '/');
  if (isAllowlisted(rel)) continue;

  let content = readFileSync(file, 'utf8');
  let fileChanges = 0;

  for (const [from, to] of REPLACEMENTS) {
    const parts = content.split(from);
    if (parts.length > 1) {
      fileChanges += parts.length - 1;
      content = parts.join(to);
    }
  }

  if (fileChanges > 0) {
    changedFiles += 1;
    totalReplacements += fileChanges;
    if (!dryRun) writeFileSync(file, content, 'utf8');
    console.log(`${dryRun ? '[dry-run] ' : ''}${rel}: ${fileChanges} replacement(s)`);
  }
}

console.log(
  `\n${dryRun ? 'Would update' : 'Updated'} ${changedFiles} files (${totalReplacements} replacements)`,
);
