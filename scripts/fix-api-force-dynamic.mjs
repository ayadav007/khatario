import fs from 'fs';
import path from 'path';

const root = path.join('app', 'api');
let fixed = 0;
let added = 0;

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name === 'route.ts') processFile(p);
  }
}

function processFile(file) {
  let s = fs.readFileSync(file, 'utf8');
  const original = s;

  // Remove dynamic export wrongly inserted inside import blocks.
  s = s.replace(
    /import \{\s*\n\s*export const dynamic = 'force-dynamic';\s*\n/g,
    'import {\n'
  );

  // Remove duplicate dynamic exports (keep first).
  const dynamicRe = /export const dynamic = 'force-dynamic';\s*\n/g;
  let seen = false;
  s = s.replace(dynamicRe, (match) => {
    if (seen) return '';
    seen = true;
    return match;
  });

  if (!/export const dynamic\s*=/.test(s)) {
    const importEnd = s.match(/^((?:import[\s\S]*?;\n)+)/);
    if (importEnd) {
      s = s.replace(importEnd[0], `${importEnd[0]}\nexport const dynamic = 'force-dynamic';\n`);
      added++;
    } else {
      s = `export const dynamic = 'force-dynamic';\n\n${s}`;
      added++;
    }
  } else if (s !== original) {
    fixed++;
  }

  if (s !== original) {
    fs.writeFileSync(file, s);
  }
}

walk(root);
console.log(`fixed ${fixed}, added ${added}`);
