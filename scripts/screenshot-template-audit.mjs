// Screenshots every HTML file written by tests/templates/template-field-audit.test.ts.
// Usage: node scripts/screenshot-template-audit.mjs
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'docs', 'qa', 'template-audit');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
await page.route('https://cdn.example.com/**', (route) => {
  const svg = route.request().url().includes('sign')
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="50"><text x="5" y="35" font-size="28" font-family="cursive" fill="#1d4ed8">ZQ Sign</text></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" rx="8" fill="#0f766e"/><text x="18" y="38" font-size="22" fill="#fff" font-family="Arial">ZQ LOGO</text></svg>';
  return route.fulfill({ contentType: 'image/svg+xml', body: svg });
});
for (const f of files) {
  const thermal = f.includes('thermal');
  await page.setViewportSize({ width: thermal ? 380 : 900, height: 1200 });
  await page.goto('file:///' + path.join(dir, f).replace(/\\/g, '/'));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(dir, f.replace(/\.html$/, '.png')), fullPage: true });
}
await browser.close();
console.log(`Captured ${files.length} screenshots in ${dir}`);
