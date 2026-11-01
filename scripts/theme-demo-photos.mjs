// Downloads the theme demo stores' stock photos once (scripts/theme-demo-photos.json), converts them to WebP under
// public/theme-demos/ (products 900 x 900, heroes 1600 x 900, each under 200 KB) and rewrites CREDITS.md.
// Run: node scripts/theme-demo-photos.mjs   (skips files that already exist; --force downloads them again)
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ROOT = 'public/theme-demos';
const LIMIT = 200 * 1024;
const force = process.argv.includes('--force');
const list = JSON.parse(fs.readFileSync('scripts/theme-demo-photos.json', 'utf8'));

async function convert(buf, hero) {
  const size = hero ? { width: 1600, height: 900 } : { width: 900, height: 900 };
  const base = sharp(buf).resize({ ...size, fit: 'cover', position: sharp.strategy.attention });
  for (let q = 78; q >= 24; q -= 6) {
    const out = await base.clone().webp({ quality: q }).toBuffer();
    if (out.length <= LIMIT) return out;
  }
  throw new Error('could not get under 200 KB');
}

let failed = 0;
for (const p of list) {
  const dest = path.join(ROOT, p.file);
  if (!force && fs.existsSync(dest)) continue;
  try {
    const res = await fetch(p.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = await convert(Buffer.from(await res.arrayBuffer()), p.file.startsWith('heroes/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out);
    console.log('ok', p.file, Math.round(out.length / 1024), 'KB');
  } catch (e) {
    failed++;
    console.log('FAIL', p.file, e.message);
  }
}

const lines = [
  '# Theme demo store photos',
  '',
  'Stock photos used by the theme demo stores (lib/store/engine/demo-catalogs.ts). Downloaded once by',
  '`scripts/theme-demo-photos.mjs` from the list in `scripts/theme-demo-photos.json` and converted to WebP.',
  '',
  '| File | Shows | Source | Licence |',
  '|---|---|---|---|',
  ...list.map((p) => `| ${p.file} | ${p.alt} | ${p.source} | ${p.licence} |`),
  '',
];
fs.writeFileSync(path.join(ROOT, 'CREDITS.md'), lines.join('\n'));
if (failed) process.exit(1);
