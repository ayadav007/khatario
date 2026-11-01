/**
 * Template gallery thumbnails: rendered once per change and kept on disk, instead of starting a
 * browser for every card on every visit.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Browser } from 'puppeteer';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { TEMPLATE_PREVIEW_PATHS } from '@/lib/template-preview-render';

/** Bump when the way thumbnails are drawn changes, so old images are not served. */
const RENDER_VERSION = '1';

const CACHE_DIR = path.join(process.cwd(), '.next', 'cache', 'template-thumbs');
const PARTIALS_DIR = path.join(process.cwd(), 'templates', 'partials');

function readOrEmpty(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Changes whenever anything the thumbnail shows changes: the template file, the shared partials,
 * the sample data or the settings passed in.
 */
export function thumbnailCacheKey(templateId: string, sampleData: unknown, settingsParam: string | null): string {
  const h = crypto.createHash('sha1');
  h.update(RENDER_VERSION);
  h.update(templateId);
  const rel = TEMPLATE_PREVIEW_PATHS[templateId];
  if (rel) h.update(readOrEmpty(path.join(process.cwd(), rel)));
  try {
    for (const f of fs.readdirSync(PARTIALS_DIR).sort()) h.update(f + readOrEmpty(path.join(PARTIALS_DIR, f)));
  } catch {
    // No partials directory: nothing to add.
  }
  h.update(JSON.stringify(sampleData));
  h.update(settingsParam || '');
  return h.digest('hex').slice(0, 16);
}

let browserPromise: Promise<Browser> | null = null;

/** One browser shared by every thumbnail render in this server process. */
function sharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch(getPuppeteerLaunchOptions()).then((b) => {
      b.on('disconnected', () => {
        browserPromise = null;
      });
      return b;
    });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

const inflight = new Map<string, Promise<Buffer>>();

/**
 * The PNG for this key: from disk when it exists, otherwise rendered (once, even when several
 * requests arrive together) and saved.
 */
export async function cachedThumbnail(
  templateId: string,
  key: string,
  renderHtml: () => Promise<string>,
): Promise<Buffer> {
  const safeId = templateId.replace(/[^a-z0-9_-]/gi, '_');
  const file = path.join(CACHE_DIR, `${safeId}-${key}.png`);
  if (fs.existsSync(file)) return fs.readFileSync(file);

  const existing = inflight.get(file);
  if (existing) return existing;

  const job = (async () => {
    const html = await renderHtml();
    const browser = await sharedBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      // Same print CSS as the PDF.
      await page.emulateMediaType('print');
      const png = Buffer.from(await page.screenshot({ type: 'png' }));
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, png);
      return png;
    } finally {
      await page.close().catch(() => {});
    }
  })();
  inflight.set(file, job);
  try {
    return await job;
  } finally {
    inflight.delete(file);
  }
}
