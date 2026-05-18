import { validateAndNormalizeInvoiceExtraction } from '../utils/invoiceExtractionValidator.js';

export const validationService = {
  async validateInvoiceData(invoiceData) {
    return validateAndNormalizeInvoiceExtraction(invoiceData);
  }
};
