import { runGeminiVisionPipeline } from '@/lib/services/invoice-extract/pipeline/geminiVisionPipeline';
import type { InvoiceExtractionInput, InvoiceExtractionProvider, InvoiceExtractionResult } from './types';

export class GeminiVisionProvider implements InvoiceExtractionProvider {
  readonly id = 'gemini-vision';

  async extract(input: InvoiceExtractionInput): Promise<InvoiceExtractionResult> {
    return runGeminiVisionPipeline(input.file, Boolean(input.includeDebug), {
      businessId: input.businessId,
    });
  }
}
