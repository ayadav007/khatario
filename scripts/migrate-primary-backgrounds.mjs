/**
 * One-shot migration: replace heavy brand-tint backgrounds with neutral slate.
 * Run: node scripts/migrate-primary-backgrounds.mjs
 * Does not modify app/globals.css (edit tokens there by hand).
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build']);

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

/** Longest-first so partial matches don't break longer strings */
const REPLACEMENTS = [
  [/bg-primary-50\/90/g, 'bg-slate-100/90'],
  [/bg-primary-50\/80/g, 'bg-slate-100/80'],
  [/bg-primary-50\/50/g, 'bg-slate-100/50'],
  [/hover:bg-primary-100\b/g, 'hover:bg-slate-100'],
  [/hover:bg-primary-50\b/g, 'hover:bg-slate-50'],
  [/active:bg-primary-100\b/g, 'active:bg-slate-100'],
  [/active:bg-primary-50\b/g, 'active:bg-slate-50'],
  [/dark:bg-primary-900\/60/g, 'dark:bg-slate-800/60'],
  [/dark:bg-primary-900\/50/g, 'dark:bg-slate-800/50'],
  [/dark:bg-primary-900\/40/g, 'dark:bg-slate-800/40'],
  [/dark:bg-primary-900\/30/g, 'dark:bg-slate-800/35'],
  [/dark:hover:bg-primary-900\/60/g, 'dark:hover:bg-slate-800/60'],
  [/bg-primary-100\b/g, 'bg-slate-100'],
  [/bg-primary-50\b/g, 'bg-slate-50'],
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
