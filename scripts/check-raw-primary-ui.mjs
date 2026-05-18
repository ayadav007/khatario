/**
 * Fails if TSX under app/ or components/ uses disallowed brand-tint utilities.
 * Allowed: app/globals.css (tokens), solid primary-500+ for CTAs/dots.
 * Disallowed: bg-primary-50, bg-primary-100, from-primary-50, to-primary-100 in JSX.
 * Run: node scripts/check-raw-primary-ui.mjs
 * Add to CI after codebase is clean.
 */
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);
const BANNED = [
  /\bbg-primary-50\b/,
  /\bbg-primary-100\b/,
  /\bfrom-primary-50\b/,
  /\bto-primary-100\b/,
  /from-primary-50\//,
];

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

const roots = ['app', 'components'].map((r) => join(process.cwd(), r));
const files = [];
for (const root of roots) {
  files.push(...walk(root));
}

const violations = [];
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const re of BANNED) {
    if (re.test(content)) {
      const rel = file.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '');
      if (!violations.find((v) => v === rel)) violations.push(rel);
    }
  }
}

if (violations.length) {
  console.error('check-raw-primary-ui: disallowed primary tint utilities in:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('check-raw-primary-ui: OK (no bg-primary-50/100 or from-primary-50 in TSX)');
