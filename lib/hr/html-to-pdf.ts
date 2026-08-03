import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';

export async function htmlToPdfBuffer(
  html: string,
  margins?: { top?: string; right?: string; bottom?: string; left?: string },
): Promise<Buffer> {
  const browser = await puppeteer.launch(getPuppeteerLaunchOptions({ headless: true }));
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
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
