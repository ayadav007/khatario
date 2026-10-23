import type { ExtractionPipelineResult } from '@/lib/services/invoice-extract/pipeline/extractionPipelineTypes';

/** What the cashier sees when no provider could read the bill. Provider details go to logs and the job row. */
export const BILL_SCAN_FAILED_MESSAGE = "Couldn't read this bill right now. Try again, or enter it manually.";

export interface ExtractionStep {
  provider: string;
  run: () => Promise<ExtractionPipelineResult>;
}

export interface ExtractionFailure {
  provider: string;
  error: string;
}

export type ExtractionChainOutcome =
  | { ok: true; extraction: ExtractionPipelineResult; failures: ExtractionFailure[] }
  | { ok: false; failures: ExtractionFailure[] };

const MAX_ERROR_CHARS = 800;

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, MAX_ERROR_CHARS);
  const code = (err as { cause?: { code?: string } }).cause?.code;
  const text = code && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
  return text.slice(0, MAX_ERROR_CHARS);
}

/** Tries each provider in order; a failure is logged and the next provider runs. */
export async function runExtractionChain(steps: ExtractionStep[]): Promise<ExtractionChainOutcome> {
  const failures: ExtractionFailure[] = [];
  for (const step of steps) {
    try {
      const extraction = await step.run();
      if (failures.length) {
        console.warn(
          `[invoices/extract] ${step.provider} succeeded after ${failures.map((f) => f.provider).join(', ')} failed.`,
        );
      }
      return { ok: true, extraction, failures };
    } catch (err) {
      const failure = { provider: step.provider, error: describeError(err) };
      failures.push(failure);
      console.error(`[invoices/extract] ${failure.provider} failed: ${failure.error}`);
    }
  }
  return { ok: false, failures };
}

/** One line per provider, for invoice_extraction_jobs.error_message. */
export function formatExtractionFailures(failures: ExtractionFailure[]): string {
  if (!failures.length) return 'No extraction provider is configured for this file type.';
  return failures.map((f) => `${f.provider}: ${f.error}`).join('\n');
}
