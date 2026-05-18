import type { InvoiceExtractionInput, InvoiceExtractionProvider, InvoiceExtractionResult } from './types';

/**
 * Placeholder for Azure Document Intelligence — reject until implemented and configured.
 */
export class AzureDocumentIntelligenceProvider implements InvoiceExtractionProvider {
  readonly id = 'azure-document-intelligence';

  extract(_input: InvoiceExtractionInput): Promise<InvoiceExtractionResult> {
    return Promise.reject(
      new Error(
        'AzureDocumentIntelligenceProvider is a stub. Wire Azure DI client and map output to IndianGstInvoiceExtract before use.',
      ),
    );
  }
}
