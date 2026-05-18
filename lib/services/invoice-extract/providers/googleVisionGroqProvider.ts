import { runGoogleVisionGroqTextPipeline } from '@/lib/services/invoice-extract/pipeline/googleVisionGroqTextPipeline';
import type { InvoiceExtractionInput, InvoiceExtractionProvider, InvoiceExtractionResult } from './types';

export class GoogleVisionGroqProvider implements InvoiceExtractionProvider {
  readonly id = 'google-vision-groq-text';

  async extract(input: InvoiceExtractionInput): Promise<InvoiceExtractionResult> {
    return runGoogleVisionGroqTextPipeline(input.file, Boolean(input.includeDebug), {
      businessId: input.businessId,
    });
  }
}
