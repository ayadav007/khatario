import fs from 'fs';
import path from 'path';
import {
  DEFAULT_OFFER_LETTER_TEMPLATE_ID,
  isValidOfferLetterTemplateId,
} from '@/lib/offer-letter-template-registry';

export function resolveOfferLetterTemplatePath(templateId: string): string {
  const id = isValidOfferLetterTemplateId(templateId) ? templateId : DEFAULT_OFFER_LETTER_TEMPLATE_ID;
  const templatePath = path.join(process.cwd(), 'templates', 'offer_letters', id, 'template.html');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Offer letter template not found: ${id}`);
  }
  return templatePath;
}
