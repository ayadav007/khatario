import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query as dbQuery } from '@/lib/db';
import { VISION_PROMPT } from '@/lib/gst-invoice-vision-prompt';
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
import { pipelineFromLlmContent } from '@/lib/services/invoice-extract/pipeline/llmExtractParse';
import { GoogleVisionGroqProvider, GeminiVisionProvider } from '@/lib/services/invoice-extract/providers';
import {
  insertInvoiceLearningEvent,
  mergeLearningInsertPayload,
} from '@/lib/services/invoice-extract/extractionLearningTelemetry';
import { recordInvoiceExtractionTelemetry } from '@/lib/services/invoice-extract/invoiceExtractionTelemetry';
import { getParserVersionMetadata } from '@/lib/services/invoice-extract/parserVersion';
import { buildSupplierLayoutFingerprint } from '@/lib/services/invoice-extract/supplierFingerprintEngine';
import { getUserIdFromRequest } from '@/lib/auth-helpers';

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

async function extractWithVision(file: File, includeDebug: boolean): Promise<ExtractionPipelineResult> {
  const groqApiKey = process.env.GROQ_API_KEY;
  const visionModel = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${file.type};base64,${base64}`;

  const startTime = Date.now();

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify({
      model: visionModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(90000),
  });

  const processingTimeMs = Date.now() - startTime;

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorBody.slice(0, 500)}`);
  }

  const result = await response.json();
  const content = result?.choices?.[0]?.message?.content;

  if (typeof content !== 'string') {
    throw new Error('Groq Vision returned no content');
  }

  const validated = pipelineFromLlmContent(content);

  const base: ExtractionPipelineResult = {
    data: validated,
    provider: 'groq-vision',
    model: result?.model || visionModel,
    processingTimeMs,
  };
  if (!includeDebug) return base;
  return {
    ...base,
    debug: {
      pipeline: 'groq-vision',
      note: 'No separate OCR text — the vision model reads the image directly. Raw OCR is only available with INVOICE_VISION_PROVIDER=google and INVOICE_EXTRACT_DEBUG=true.',
    },
  };
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
 * Images: Groq vision by default; set INVOICE_VISION_PROVIDER=google + GOOGLE_VISION_API_KEY to test
 * Google Vision OCR + Groq text. PDFs use OCR service. Falls back per EXTRACTION_MODE.
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

    const useGoogleVisionPipeline =
      visionProvider === 'google' && Boolean(googleVisionKey) && Boolean(groqKey);
    const useGeminiVisionPipeline =
      visionProvider === 'gemini' && Boolean(geminiKey);
    const useGroqVisionPipeline =
      visionProvider === 'groq' && Boolean(groqKey);

    const canUseVision =
      IMAGE_MIME_TYPES.has(file.type) &&
      (useGoogleVisionPipeline || useGeminiVisionPipeline || useGroqVisionPipeline);
    const useVision = (extractionMode === 'vision' || extractionMode === 'auto') && canUseVision;

    if (visionProvider === 'google' && IMAGE_MIME_TYPES.has(file.type) && !useGoogleVisionPipeline) {
      console.warn(
        '[invoices/extract] INVOICE_VISION_PROVIDER=google but GOOGLE_VISION_API_KEY and GROQ_API_KEY are both required; falling back to OCR service or non-vision path.'
      );
    }
    if (visionProvider === 'gemini' && !geminiKey) {
      console.warn('[invoices/extract] INVOICE_VISION_PROVIDER=gemini but GEMINI_API_KEY is not set; falling back.');
    }

    const includeDebug = invoiceExtractDebugEnabled();
    let extraction: ExtractionPipelineResult;

    if (useVision) {
      try {
        if (useGeminiVisionPipeline) {
          try {
            extraction = await extractWithGeminiVision(file, includeDebug, businessId);
          } catch (geminiError: any) {
            // Gemini failed (quota, rate limit, network) — fall back to Groq vision if available
            if (groqKey) {
              console.warn(`[invoices/extract] Gemini failed (${geminiError.message?.slice(0, 120)}); falling back to Groq vision.`);
              extraction = await extractWithVision(file, includeDebug);
            } else {
              throw geminiError;
            }
          }
        } else if (useGoogleVisionPipeline) {
          extraction = await extractWithGoogleVisionThenGroqText(file, includeDebug, businessId);
        } else {
          extraction = await extractWithVision(file, includeDebug);
        }
      } catch (visionError: any) {
        console.error('Vision extraction failed:', visionError.message);

        if (extractionMode === 'vision') {
          await dbQuery(
            `UPDATE invoice_extraction_jobs
             SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            ['failed', visionError.message, extractionJob.id]
          );
          return NextResponse.json(
            { success: false, error: `Vision extraction failed: ${visionError.message}`, job_id: extractionJob.id },
            { status: 422 }
          );
        }

        try {
          extraction = await extractWithOcrService(file, includeDebug);
        } catch (ocrError: any) {
          await dbQuery(
            `UPDATE invoice_extraction_jobs
             SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            ['failed', ocrError.message, extractionJob.id]
          );

          if (ocrError.cause?.code === 'ECONNREFUSED' || ocrError.message?.includes('ECONNREFUSED')) {
            return NextResponse.json(
              { error: 'Both vision and OCR extraction failed. OCR service is not running.' },
              { status: 503 }
            );
          }
          return NextResponse.json(
            { success: false, error: ocrError.message, job_id: extractionJob.id },
            { status: 422 }
          );
        }
      }
    } else {
      try {
        extraction = await extractWithOcrService(file, includeDebug);
      } catch (ocrError: any) {
        console.error('OCR service error:', ocrError);
        await dbQuery(
          `UPDATE invoice_extraction_jobs
           SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          ['failed', ocrError.message, extractionJob.id]
        );

        if (ocrError.cause?.code === 'ECONNREFUSED' || ocrError.message?.includes('ECONNREFUSED')) {
          return NextResponse.json(
            { error: 'OCR extraction service is not running. Start it with: node ocr-service/src/server.js' },
            { status: 503 }
          );
        }
        return NextResponse.json(
          { success: false, error: ocrError.message, job_id: extractionJob.id },
          { status: 422 }
        );
      }
    }

    const frontendData = transformExtractToPurchaseReviewFormat(extraction!.data);

    await dbQuery(
      `UPDATE invoice_extraction_jobs
       SET status = $1,
           extraction_data = $2,
           extraction_method = $3,
           processing_time_ms = $4,
           extracted_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      ['completed', JSON.stringify(frontendData), `${extraction!.provider}/${extraction!.model}`, extraction!.processingTimeMs, extractionJob.id]
    );

    const userId = getUserIdFromRequest(request);
    const parserBundle = getParserVersionMetadata();
    const learningPayload = mergeLearningInsertPayload(extraction!.learningSnapshot, {
      extraction_method: `${extraction!.provider}/${extraction!.model}`,
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

    const spatialProfile = extraction!.learningSnapshot?.spatialProfile ?? undefined;
    const supplierFp = buildSupplierLayoutFingerprint({
      extract: extraction!.data,
      spatialProfile: spatialProfile ?? undefined,
    });
    void recordInvoiceExtractionTelemetry({
      businessId,
      extractionJobId: extractionJob.id,
      invoiceId: null,
      supplierHash: supplierFp.supplierHash,
      pipeline: extraction!,
      learningSnapshot: extraction!.learningSnapshot,
    });

    const jsonBody: Record<string, unknown> = {
      success: true,
      job_id: extractionJob.id,
      data: frontendData,
      gst_extraction: extraction!.data,
      extraction_method: `${extraction!.provider}/${extraction!.model}`,
      processing_time_ms: extraction!.processingTimeMs,
      extraction_pipeline_versions: parserBundle,
    };
    if (invoiceConfidenceEngineEnabled()) {
      const historical = await loadHistoricalConfidenceSignalsFromDb({
        layoutFingerprint: extraction!.learningSnapshot?.layoutFingerprint ?? null,
        supplierName: extraction!.data.supplier_name,
        supplierGstin: extraction!.data.supplier_gstin,
      });
      const ctx: InvoiceConfidenceContext = {
        gstPropagation: extraction!.gstPropagation ?? null,
        ocrGstSummary: extraction!.ocrGstSummary ?? undefined,
        spatial: extraction!.spatialDocument ?? undefined,
        semanticLines: undefined,
        headerAlignmentScore: undefined,
        historical,
      };
      jsonBody.extraction_confidence = calculateInvoiceConfidence(extraction!.data, ctx);
    }
    if (includeDebug && extraction!.debug && Object.keys(extraction!.debug).length > 0) {
      jsonBody.debug = extraction!.debug;
    }
    if (extraction!.ocrGstSummary) {
      jsonBody.ocr_gst_summary = extraction!.ocrGstSummary;
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
