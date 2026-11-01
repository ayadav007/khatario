import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { assertPublicHttpUrl } from '@/lib/http/outbound-media';

export async function htmlToPdfBuffer(
  html: string,
  margins?: { top?: string; right?: string; bottom?: string; left?: string },
): Promise<Buffer> {
  const browser = await puppeteer.launch(getPuppeteerLaunchOptions({ headless: true }));
  try {
    const page = await browser.newPage();
    // Tenant-written HTML: no scripts, and no requests except inline data and public https
    // images (the business logo). Internal and metadata addresses are refused.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url === 'about:blank') {
        void req.continue();
        return;
      }
      if (req.resourceType() !== 'image') {
        void req.abort();
        return;
      }
      assertPublicHttpUrl(url, { httpsOnly: true })
        .then(() => req.continue())
        .catch(() => req.abort());
    });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20000 });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: margins?.top ?? '10mm',
        right: margins?.right ?? '10mm',
        bottom: margins?.bottom ?? '10mm',
        left: margins?.left ?? '10mm',
      },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
