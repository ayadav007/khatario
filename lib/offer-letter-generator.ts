import * as db from '@/lib/db';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { getOfferLetterTemplateSettings } from '@/lib/hr/offer-letter-template-settings';
import {
  buildViewModelFromOfferRow,
  compileOfferLetterHtml,
  generateOfferLetterPreviewHtml,
} from '@/lib/offer-letter-render';

export { generateOfferLetterPreviewHtml } from '@/lib/offer-letter-render';

export async function generateOfferLetterHtml(offerId: string): Promise<string> {
  const row = await db.queryOne<{
    id: string;
    business_id: string;
    designation: string;
    department: string | null;
    joining_date: string;
    probation_months: number | null;
    work_location: string | null;
    annual_bonus: string | null;
    notice_period_days: number | null;
    basic_salary: string;
    hra: string | null;
    transport_allowance: string | null;
    medical_allowance: string | null;
    special_allowance: string | null;
    other_allowances: string | null;
    terms_text: string | null;
    signatory_name: string | null;
    signatory_title: string | null;
    candidate_signature_url: string | null;
    accepted_at: string | null;
    candidate_name: string;
    business_name: string;
    business_address: string;
    business_logo: string | null;
    business_signature: string | null;
  }>(
    `SELECT o.*,
      c.full_name AS candidate_name,
      b.name AS business_name,
      CONCAT(
        COALESCE(b.address_line1, ''),
        CASE WHEN b.address_line2 IS NOT NULL THEN ', ' || b.address_line2 ELSE '' END,
        CASE WHEN b.city IS NOT NULL THEN ', ' || b.city ELSE '' END,
        CASE WHEN b.state IS NOT NULL THEN ', ' || b.state ELSE '' END,
        CASE WHEN b.pincode IS NOT NULL THEN ' - ' || b.pincode ELSE '' END
      ) AS business_address,
      b.logo_url AS business_logo,
      b.signature_url AS business_signature
     FROM recruitment_offer_letters o
     INNER JOIN recruitment_candidates c ON c.id = o.candidate_id
     INNER JOIN businesses b ON b.id = o.business_id
     WHERE o.id = $1`,
    [offerId],
  );

  if (!row) throw new Error('Offer not found');

  const { template_id, settings } = await getOfferLetterTemplateSettings(row.business_id);
  const model = buildViewModelFromOfferRow(row, settings);
  return compileOfferLetterHtml(template_id, model);
}

export async function generateOfferLetterPdf(offerId: string): Promise<Buffer> {
  const html = await generateOfferLetterHtml(offerId);

  const browser = await puppeteer.launch(
    getPuppeteerLaunchOptions({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }),
  );

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

export async function getOfferIdForCandidate(
  candidateId: string,
  businessId: string,
): Promise<string | null> {
  const row = await db.queryOne<{ id: string }>(
    `SELECT id FROM recruitment_offer_letters
     WHERE candidate_id = $1 AND business_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [candidateId, businessId],
  );
  return row?.id ?? null;
}
