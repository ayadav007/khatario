import type { ExtractionPipelineResult } from '@/lib/services/invoice-extract/pipeline/extractionPipelineTypes';

export interface InvoiceExtractionInput {
  file: File;
  /** When true, provider may attach larger debug payloads */
  includeDebug?: boolean;
  /** Tenant scope — enables supplier-aware deterministic config + correction priors when set */
  businessId?: string;
}

export type InvoiceExtractionResult = ExtractionPipelineResult;

export interface InvoiceExtractionProvider {
  readonly id: string;
  extract(input: InvoiceExtractionInput): Promise<InvoiceExtractionResult>;
}
