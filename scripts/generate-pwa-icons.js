/**
 * Generates PWA icons (192x192 and 512x512) for Khatario.
 * Run: npm run pwa:icons   or   node scripts/generate-pwa-icons.js
 * Requires: npm install sharp (dev dependency)
 */
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

const createIcon = async (size) => {
  const sharp = require('sharp');
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="#2563eb" rx="${size/8}"/>
    <text x="${size/2}" y="${size*0.62}" font-family="Arial,sans-serif" font-size="${size*0.5}" font-weight="bold" fill="white" text-anchor="middle">K</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};

(async () => {
  try {
    const sharp = require('sharp');
    const [icon192, icon512] = await Promise.all([
      createIcon(192),
      createIcon(512),
    ]);
    fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), icon192);
    fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), icon512);
    console.log('PWA icons generated at public/icons/');
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.log('Run: npm install sharp --save-dev');
      console.log('Then run this script again.');
    }
    throw e;
  }
})();
