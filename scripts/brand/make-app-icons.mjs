// Builds every app icon, splash image and favicon from one logo SVG.
// Usage: node scripts/brand/make-app-icons.mjs <logo.svg>
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) throw new Error('Pass the logo SVG path');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const CREAM = { r: 252, g: 249, b: 240, alpha: 1 };
const logo = await sharp(src, { density: 300 }).resize(2048, 2048).png().toBuffer();

const logoAt = (size) => sharp(logo).resize(Math.round(size), Math.round(size)).png().toBuffer();
async function onSquare(size, logoShare, { bg = CREAM, radius = 0 } = {}) {
  const inner = Math.round(size * logoShare);
  const off = Math.round((size - inner) / 2);
  let base = sharp({ create: { width: size, height: size, channels: 4, background: bg } });
  const layers = [{ input: await logoAt(inner), left: off, top: off }];
  let out = await base.composite(layers).png().toBuffer();
  if (radius > 0) {
    const r = Math.round(size * radius);
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`);
    out = await sharp(out).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  }
  return out;
}
async function onCircle(size, logoShare) {
  const sq = await onSquare(size, logoShare);
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);
  return sharp(sq).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}
async function splash(w, h, share = 0.32) {
  const inner = Math.round(Math.min(w, h) * share);
  return sharp({ create: { width: w, height: h, channels: 4, background: CREAM } })
    .composite([{ input: await logoAt(inner), left: Math.round((w - inner) / 2), top: Math.round((h - inner) / 2) }])
    .png().toBuffer();
}
const write = (rel, buf) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); console.log(rel); };

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
// Adaptive foreground: 108dp canvas, logo inside the 66dp safe zone.
const fgShare = 0.56;
const legacyShare = 0.68;

for (const [d, k] of Object.entries(densities)) {
  const legacy = Math.round(48 * k), fg = Math.round(108 * k);
  const foreground = await sharp({ create: { width: fg, height: fg, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await logoAt(fg * fgShare), left: Math.round(fg * (1 - fgShare) / 2), top: Math.round(fg * (1 - fgShare) / 2) }]).png().toBuffer();
  // Flutter shop and staff app (phone/)
  write(`phone/android/app/src/main/res/mipmap-${d}/ic_launcher.png`, await onSquare(legacy, legacyShare, { radius: 0.18 }));
  write(`phone/android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`, await onCircle(legacy, legacyShare * 0.92));
  write(`phone/android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, foreground);
  write(`phone/android/app/src/main/res/drawable-${d}/splash_logo.png`, await logoAt(Math.round(140 * k)));
  // Capacitor customer app (android/)
  write(`android/app/src/main/res/mipmap-${d}/ic_launcher.png`, await onSquare(legacy, legacyShare, { radius: 0.18 }));
  write(`android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`, await onCircle(legacy, legacyShare * 0.92));
  write(`android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, foreground);
}
// Capacitor splash images, same sizes as before.
const capSplash = {
  'drawable/splash.png': [480, 320],
  'drawable-land-mdpi/splash.png': [480, 320], 'drawable-land-hdpi/splash.png': [800, 480], 'drawable-land-xhdpi/splash.png': [1280, 720],
  'drawable-land-xxhdpi/splash.png': [1600, 960], 'drawable-land-xxxhdpi/splash.png': [1920, 1280],
  'drawable-port-mdpi/splash.png': [320, 480], 'drawable-port-hdpi/splash.png': [480, 800], 'drawable-port-xhdpi/splash.png': [720, 1280],
  'drawable-port-xxhdpi/splash.png': [960, 1600], 'drawable-port-xxxhdpi/splash.png': [1280, 1920],
};
for (const [rel, [w, h]] of Object.entries(capSplash)) write(`android/app/src/main/res/${rel}`, await splash(w, h));

// Website: favicon (Next.js app/icon.png), Apple touch icon, PWA icons, favicon.ico.
write('app/icon.png', await onSquare(512, 0.8, { radius: 0.2 }));
write('app/apple-icon.png', await onSquare(180, 0.7));
write('public/icons/icon-192.png', await onSquare(192, 0.62));
write('public/icons/icon-512.png', await onSquare(512, 0.62));
const icoSizes = [16, 32, 48];
const pngs = await Promise.all(icoSizes.map((s) => onSquare(s, 0.86, { radius: 0.2 })));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length; const dir = [];
pngs.forEach((png, i) => { const e = Buffer.alloc(16); const s = icoSizes[i]; e.writeUInt8(s, 0); e.writeUInt8(s, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12); offset += png.length; dir.push(e); });
write('app/favicon.ico', Buffer.concat([header, ...dir, ...pngs]));
