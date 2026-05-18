/**
 * Replace primary-tinted gradient stops with neutral slate (same rollout as migrate-primary-backgrounds).
 * Run: node scripts/migrate-primary-gradients.mjs
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

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

const REPLACEMENTS = [
  [/from-primary-50\/90/g, 'from-slate-50/90'],
  [/from-primary-50\/80/g, 'from-slate-50/80'],
  [/from-primary-50\/60/g, 'from-slate-50/60'],
  [/via-primary-50/g, 'via-slate-50'],
  [/from-primary-50\b/g, 'from-slate-50'],
  [/to-primary-100\b/g, 'to-slate-100'],
  [/to-primary-50\b/g, 'to-slate-50'],
  [/dark:from-primary-900\/20/g, 'dark:from-slate-900/20'],
  [/dark:from-primary-900\/95/g, 'dark:from-slate-900/95'],
];

const roots = ['app', 'components'].map((r) => join(process.cwd(), r));
let changed = 0;
let files = [];
for (const root of roots) {
  files = files.concat(walk(root));
}

for (const file of files) {
  let s = readFileSync(file, 'utf8');
  const orig = s;
  for (const [re, rep] of REPLACEMENTS) {
    s = s.replace(re, rep);
  }
  if (s !== orig) {
    writeFileSync(file, s, 'utf8');
    changed++;
    console.log('updated:', file.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', ''));
  }
}
console.log(`\nDone. ${changed} files updated.`);
