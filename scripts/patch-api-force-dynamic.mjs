import fs from 'fs';
import path from 'path';

const root = path.join('app', 'api');
let patched = 0;
let skipped = 0;

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name === 'route.ts') patch(p);
  }
}

function patch(file) {
  let s = fs.readFileSync(file, 'utf8');
  if (/export const dynamic\s*=/.test(s)) {
    skipped++;
    return;
  }
  const m = s.match(/^((?:import[^\n]*\n)+)/);
  if (m) {
    s = s.replace(m[0], `${m[0]}\nexport const dynamic = 'force-dynamic';\n`);
  } else {
    s = `export const dynamic = 'force-dynamic';\n\n${s}`;
  }
  fs.writeFileSync(file, s);
  patched++;
}

walk(root);
console.log(`patched ${patched}, skipped ${skipped}`);
