import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query as dbQuery } from '@/lib/db';
import {
  coerceRawInvoiceJson,
  normalizeIndianGstInvoiceExtract,
  transformExtractToPurchaseReviewFormat,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';
import {
  calculateInvoiceConfidence,
  invoiceConfidenceEngineEnabled,
  loadHistoricalConfidenceSignalsFromDb,
  type InvoiceConfidenceContext,
} from '@/lib/services/invoice-extract/confidence';
import type { ExtractionPipelineResult } from '@/lib/services/invoice-extract/pipeline/extractionPipelineTypes';
import { runGroqVisionPipeline } from '@/lib/services/invoice-extract/pipeline/groqVisionPipeline';
import {
  BILL_SCAN_FAILED_MESSAGE,
  formatExtractionFailures,
  runExtractionChain,
  type ExtractionStep,
} from '@/lib/services/invoice-extract/extractionChain';
import { GoogleVisionGroqProvider, GeminiVisionProvider } from '@/lib/services/invoice-extract/providers';
import {
  closerToPrintedTotal,
  extractionTotalCheck,
  totalRecheckNote,
} from '@/lib/services/invoice-extract/totalRecheck';
import {
  insertInvoiceLearningEvent,
  mergeLearningInsertPayload,
} from '@/lib/services/invoice-extract/extractionLearningTelemetry';
import { recordInvoiceExtractionTelemetry } from '@/lib/services/invoice-extract/invoiceExtractionTelemetry';
import { getParserVersionMetadata } from '@/lib/services/invoice-extract/parserVersion';
import { buildSupplierLayoutFingerprint } from '@/lib/services/invoice-extract/supplierFingerprintEngine';
import { getUserIdFromRequest } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

function invoiceExtractDebugEnabled(): boolean {
  const v = (process.env.INVOICE_EXTRACT_DEBUG || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp'
]);

const googleVisionGroqProvider = new GoogleVisionGroqProvider();
const geminiVisionProvider = new GeminiVisionProvider();

async function extractWithGoogleVisionThenGroqText(
  file: File,
  includeDebug: boolean,
  businessId: string,
): Promise<ExtractionPipelineResult> {
  return googleVisionGroqProvider.extract({ file, includeDebug, businessId });
}

async function extractWithGeminiVision(
  file: File,
  includeDebug: boolean,
  businessId: string,
): Promise<ExtractionPipelineResult> {
  return geminiVisionProvider.extract({ file, includeDebug, businessId });
}

type TotalRecheck = {
  first_lines_total: number;
  second_lines_total: number | null;
  printed_total: number;
  kept: 'first' | 'second';
};

/**
 * A Gemini read whose lines do not add up to the printed payable gets one more read with
 * the gap spelled out in the prompt. The read closer to the printed total is kept; a failed
 * second read keeps the first.
 */
async function secondReadWhenTotalMisses(
  first: ExtractionPipelineResult,
  file: File,
  includeDebug: boolean,
  businessId: string,
): Promise<{ extraction: ExtractionPipelineResult; recheck: TotalRecheck | null }> {
  if (first.provider !== 'gemini-vision') return { extraction: first, recheck: null };
  const firstCheck = extractionTotalCheck(first.data);
  if (!firstCheck || firstCheck.gap == null) return { extraction: first, recheck: null };
  try {
    const second = await geminiVisionProvider.extract({
      file,
      includeDebug,
      businessId,
      promptNote: totalRecheckNote(firstCheck, first.data.items.length),
    });
    const secondCheck = extractionTotalCheck(second.data);
    const kept = closerToPrintedTotal({ result: first, check: firstCheck }, { result: second, check: secondCheck });
    const recheck: TotalRecheck = {
      first_lines_total: firstCheck.linesTotal,
      second_lines_total: secondCheck?.linesTotal ?? null,
      printed_total: firstCheck.printed,
      kept: kept === second ? 'second' : 'first',
    };
    console.warn(`[invoices/extract] total recheck (${second.model}): ${JSON.stringify(recheck)}`);
    return {
      extraction: { ...kept, processingTimeMs: first.processingTimeMs + second.processingTimeMs },
      recheck,
    };
  } catch (err) {
    console.warn(`[invoices/extract] second read failed, keeping the first: ${err instanceof Error ? err.message : String(err)}`);
    return { extraction: first, recheck: null };
  }
}

async function extractWithOcrService(file: File, includeDebug: boolean): Promise<ExtractionPipelineResult> {
  const ocrServiceUrl = process.env.OCR_SERVICE_URL || 'http://127.0.0.1:4000';
  const startTime = Date.now();

  const extractFormData = new FormData();
  extractFormData.append('file', file);

  const extractResponse = await fetch(`${ocrServiceUrl}/api/invoices/upload`, {
    method: 'POST',
    body: extractFormData,
    signal: AbortSignal.timeout(120000),
  });

  const processingTimeMs = Date.now() - startTime;
  const extractResult = await extractResponse.json();

  if (!extractResult.success || !extractResult.data?.extraction?.data) {
    throw new Error(extractResult.error?.message || extractResult.message || 'OCR extraction failed');
  }

  const base: ExtractionPipelineResult = {
    data: normalizeIndianGstInvoiceExtract(
      coerceRawInvoiceJson(extractResult.data.extraction.data)
    ),
    provider: extractResult.data.extraction.provider || 'ocr',
    model: extractResult.data.extraction.model || 'unknown',
    processingTimeMs,
  };
  if (!includeDebug) return base;
  return {
    ...base,
    debug: {
      pipeline: 'ocr-service',
      note: 'Structured data from the local OCR service. Raw OCR text is not attached here; check OCR service logs if needed.',
    },
  };
}

/**
 * POST /api/invoices/extract
 * Images: INVOICE_VISION_PROVIDER first (gemini by default; google = Google Vision OCR + Groq text),
 * then Gemini, then Groq vision, then the OCR service. PDFs and EXTRACTION_MODE=ocr use the OCR service.
 * Each provider walks its own model list (GEMINI_MODELS / GROQ_VISION_MODELS).
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const businessId = formData.get('business_id') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const allowedTypes = [
      'application/pdf',
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff'
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: PDF, JPG, PNG, GIF, BMP, TIFF' },
        { status: 400 }
      );
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size too large. Maximum size is 10MB' },
        { status: 400 }
      );
    }

    const extractionJob = await queryOne(
      `INSERT INTO invoice_extraction_jobs (
        business_id, file_name, file_type, status
      ) VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [businessId, file.name, file.type, 'processing']
    );

    const extractionMode = process.env.EXTRACTION_MODE || 'vision';
    const visionProvider = (process.env.INVOICE_VISION_PROVIDER || 'gemini').toLowerCase().trim();
    const googleVisionKey = process.env.GOOGLE_VISION_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (visionProvider === 'google' && IMAGE_MIME_TYPES.has(file.type) && !(googleVisionKey && groqKey)) {
      console.warn(
        '[invoices/extract] INVOICE_VISION_PROVIDER=google but GOOGLE_VISION_API_KEY and GROQ_API_KEY are both required; falling back.'
      );
    }
    if (visionProvider === 'gemini' && !geminiKey) {
      console.warn('[invoices/extract] INVOICE_VISION_PROVIDER=gemini but GEMINI_API_KEY is not set; falling back.');
    }

    const includeDebug = invoiceExtractDebugEnabled();

    // Images: preferred vision provider, then the other vision providers, then the OCR service.
    // PDFs and EXTRACTION_MODE=ocr: OCR service only.
    const steps: ExtractionStep[] = [];
    const useVision = (extractionMode === 'vision' || extractionMode === 'auto') && IMAGE_MIME_TYPES.has(file.type);
    if (useVision) {
      const visionSteps: Record<string, ExtractionStep | null> = {
        google: visionProvider === 'google' && googleVisionKey && groqKey
          ? { provider: 'google-vision+groq', run: () => extractWithGoogleVisionThenGroqText(file, includeDebug, businessId) }
          : null,
        gemini: geminiKey
          ? { provider: 'gemini-vision', run: () => extractWithGeminiVision(file, includeDebug, businessId) }
          : null,
        groq: groqKey
          ? { provider: 'groq-vision', run: () => runGroqVisionPipeline(file, includeDebug, { businessId }) }
          : null,
      };
      for (const name of Array.from(new Set([visionProvider, 'gemini', 'groq']))) {
        const step = visionSteps[name];
        if (step) steps.push(step);
      }
    }
    steps.push({ provider: 'ocr-service', run: () => extractWithOcrService(file, includeDebug) });

    const outcome = await runExtractionChain(steps);
    if (!outcome.ok) {
      await dbQuery(
        `UPDATE invoice_extraction_jobs
         SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        ['failed', formatExtractionFailures(outcome.failures), extractionJob.id]
      );
      return NextResponse.json(
        { success: false, error: BILL_SCAN_FAILED_MESSAGE, job_id: extractionJob.id },
        { status: 422 }
      );
    }
    const { extraction, recheck } = await secondReadWhenTotalMisses(
      outcome.extraction,
      file,
      includeDebug,
      businessId,
    );

    const frontendData = transformExtractToPurchaseReviewFormat(extraction.data);

    await dbQuery(
      `UPDATE invoice_extraction_jobs
       SET status = $1,
           extraction_data = $2,
           extraction_method = $3,
           processing_time_ms = $4,
           extracted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      ['extracted', JSON.stringify(frontendData), `${extraction.provider}/${extraction.model}`, extraction.processingTimeMs, extractionJob.id]
    );

    const userId = getUserIdFromRequest(request);
    const parserBundle = getParserVersionMetadata();
    const learningPayload = mergeLearningInsertPayload(extraction.learningSnapshot, {
      extraction_method: `${extraction.provider}/${extraction.model}`,
      file_mime_type: file.type,
      parser_versions: parserBundle,
    });
    void insertInvoiceLearningEvent({
      businessId,
      userId,
      extractionJobId: extractionJob.id,
      eventType: 'parse_complete',
      payload: learningPayload,
    });

    const spatialProfile = extraction.learningSnapshot?.spatialProfile ?? undefined;
    const supplierFp = buildSupplierLayoutFingerprint({
      extract: extraction.data,
      spatialProfile: spatialProfile ?? undefined,
    });
    void recordInvoiceExtractionTelemetry({
      businessId,
      extractionJobId: extractionJob.id,
      invoiceId: null,
      supplierHash: supplierFp.supplierHash,
      pipeline: extraction,
      learningSnapshot: extraction.learningSnapshot,
    });

    const jsonBody: Record<string, unknown> = {
      success: true,
      job_id: extractionJob.id,
      data: frontendData,
      gst_extraction: extraction.data,
      extraction_method: `${extraction.provider}/${extraction.model}`,
      processing_time_ms: extraction.processingTimeMs,
      extraction_pipeline_versions: parserBundle,
    };
    if (recheck) jsonBody.total_recheck = recheck;
    if (invoiceConfidenceEngineEnabled()) {
      const historical = await loadHistoricalConfidenceSignalsFromDb({
        layoutFingerprint: extraction.learningSnapshot?.layoutFingerprint ?? null,
        supplierName: extraction.data.supplier_name,
        supplierGstin: extraction.data.supplier_gstin,
      });
      const ctx: InvoiceConfidenceContext = {
        gstPropagation: extraction.gstPropagation ?? null,
        ocrGstSummary: extraction.ocrGstSummary ?? undefined,
        spatial: extraction.spatialDocument ?? undefined,
        semanticLines: undefined,
        headerAlignmentScore: undefined,
        historical,
      };
      jsonBody.extraction_confidence = calculateInvoiceConfidence(extraction.data, ctx);
    }
    if (includeDebug && extraction.debug && Object.keys(extraction.debug).length > 0) {
      jsonBody.debug = extraction.debug;
    }
    if (extraction.ocrGstSummary) {
      jsonBody.ocr_gst_summary = extraction.ocrGstSummary;
    }

    return NextResponse.json(jsonBody);
  } catch (error: any) {
    console.error('Error in extract API:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/invoices/extract?job_id=xxx
 * Get extraction job status and result
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('job_id');

    if (!jobId) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
    }

    const job = await queryOne(
      `SELECT * FROM invoice_extraction_jobs WHERE id = $1`,
      [jobId]
    );

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const sessionBiz = request.headers.get('x-authenticated-business-id');
    if (sessionBiz && job.business_id !== sessionBiz) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ job });
  } catch (error: any) {
    console.error('Error getting extraction job:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
