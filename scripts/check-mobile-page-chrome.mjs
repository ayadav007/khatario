#!/usr/bin/env node
/**
 * Flags app pages with duplicate mobile headers: in-page Back + large h1
 * without the standard chrome helpers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app', '(app)');

const COMPOSER_HINTS = ['/new/page.tsx', '/edit/page.tsx'];

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (name === 'page.tsx') files.push(full);
  }
  return files;
}

function analyze(src) {
  const usesHelper =
    src.includes('MobileDuplicatePageChrome') ||
    src.includes('ListPageHeader');

  const hasLargeH1 = /<h1[^>]*className="[^"]*text-2xl[^"]*font-bold/.test(src);
  const h1UsesListPageClass = /<h1[^>]*className="[^"]*list-page-h1/.test(src);
  const h1HiddenOnMobile = /<h1[^>]*className="[^"]*hidden\s+md:(block|flex)/.test(src);

  const hasBackText = />\s*Back[\s\w]*</.test(src);
  const backButtonHiddenMd =
    /className="[^"]*hidden\s+md:[^"]*"[^>]*>[\s\S]{0,120}Back/.test(src) ||
    /Back[\s\S]{0,80}hidden\s+md:/.test(src);

  const headerBlockHiddenMd =
    /<div[^>]*className="[^"]*hidden\s+md:(flex|block)[^"]*"[^>]*>[\s\S]{0,400}text-2xl[^"]*font-bold/.test(
      src
    );

  const titleOverride = src.includes('useMobileHeaderTitleOverride');

  const h1Ok =
    !hasLargeH1 ||
    h1UsesListPageClass ||
    h1HiddenOnMobile ||
    headerBlockHiddenMd ||
    usesHelper;

  const backOk = !hasBackText || backButtonHiddenMd || headerBlockHiddenMd || usesHelper;

  const titleOk = titleOverride && (h1UsesListPageClass || h1HiddenOnMobile || !hasLargeH1);

  return {
    usesHelper,
    nonCompliant: hasLargeH1 && hasBackText && !(usesHelper || (h1Ok && backOk) || titleOk),
  };
}

const offenders = [];

for (const file of walk(appDir)) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  const { nonCompliant } = analyze(src);
  if (nonCompliant) {
    offenders.push({
      rel,
      looksLikeComposer: COMPOSER_HINTS.some((h) => rel.includes(h.replace(/^\//, ''))),
    });
  }
}

if (offenders.length === 0) {
  console.log('check-mobile-page-chrome: OK');
  process.exit(0);
}

console.error('check-mobile-page-chrome: pages still need MobileDuplicatePageChrome or ListPageHeader:\n');
for (const { rel, looksLikeComposer } of offenders) {
  console.error(`  - ${rel}${looksLikeComposer ? ' (composer)' : ''}`);
}
console.error(
  '\nFix: MobileDuplicatePageChrome (forms/detail) or ListPageHeader (lists).'
);
process.exit(1);
