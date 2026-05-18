import { ocrService } from './ocr.service.js';
import { llmService } from './llm.service.js';
import { validationService } from './validation.service.js';
import { khatarioIntegrationService } from './khatarioIntegration.service.js';
import { toPublicFileMetadata } from '../utils/fileUtils.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { preprocessOcrText } from '../utils/ocrTextPreprocess.js';
import { estimateTokenMetrics } from '../utils/tokenMetrics.js';
import { reconstructInvoiceLineItemsFromBlocks } from '../utils/tableReconstruction.js';
import { detectDocumentZones, filterBlocksByZone } from '../utils/documentZoning.js';
import { parseTaxSummaryTableFromBlocks } from '../utils/taxTableParser.js';
import { extractInvoiceDataWithVision } from './llm/groqVision.service.js';

const isImageFile = (file) => {
  const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp'];
  return imageTypes.includes(file?.mimetype);
};

const tryVisionExtraction = async ({ file, metadata }) => {
  const requestId = metadata.requestId || null;

  logger.info({
    message: 'Attempting vision-based extraction',
    requestId,
    file: file?.originalname,
    mode: env.extraction.mode
  });

  const extractionResult = await extractInvoiceDataWithVision(file, { requestId });

  const validationResult = await validationService.validateInvoiceData(extractionResult.data);
  const integrationReadiness = khatarioIntegrationService.getReadiness({ validationResult });

  logger.info({
    message: 'Vision extraction succeeded',
    requestId,
    provider: extractionResult.provider,
    model: extractionResult.model,
    confidence: extractionResult.confidence
  });

  return {
    requestId,
    file: toPublicFileMetadata(file),
    ocr: {
      provider: 'vision-direct',
      rawText: null,
      textBlocks: [],
      confidenceScores: [],
      confidence: null,
      textPreview: null,
      pages: [],
      metadata: { mode: 'vision' }
    },
    extraction: {
      provider: extractionResult.provider,
      model: extractionResult.model,
      data: extractionResult.data,
      confidence: extractionResult.confidence,
      validation: extractionResult.validation,
      metadata: extractionResult.metadata,
      debug: env.debugMode ? extractionResult.debug : undefined
    },
    validation: validationResult,
    integration: integrationReadiness
  };
};

const runOcrPipeline = async ({ file, metadata }) => {
  const ocrResult = await ocrService.extractTextFromInvoice(file);
  const rawOcrText = ocrResult.rawText || ocrResult.text || '';
  const ocrPre = preprocessOcrText(rawOcrText, { compactMode: env.ocr.compactMode });
  const zoning = detectDocumentZones(ocrResult.textBlocks || []);
  const lineItemBlocks = filterBlocksByZone(ocrResult.textBlocks || [], zoning.zones.lineItemTable);
  const taxBlocks = filterBlocksByZone(ocrResult.textBlocks || [], zoning.zones.taxSummaryTable);

  const table = reconstructInvoiceLineItemsFromBlocks(lineItemBlocks);
  const taxTable = parseTaxSummaryTableFromBlocks(taxBlocks);

  if (env.debugMode) {
    logger.info({
      message: 'RAW OCR text before LLM',
      requestId: metadata.requestId || null,
      file: file?.originalname,
      ocrProvider: ocrResult.provider,
      rawOcrText: ocrPre.raw
    });
    logger.info({
      message: 'CLEANED OCR text before LLM',
      requestId: metadata.requestId || null,
      file: file?.originalname,
      ocrProvider: ocrResult.provider,
      cleanedOcrText: ocrPre.cleaned
    });
    logger.info({
      message: 'COMPACTED OCR text before LLM',
      requestId: metadata.requestId || null,
      file: file?.originalname,
      ocrProvider: ocrResult.provider,
      compactedOcrText: ocrPre.compacted
    });
  }

  const extractionResult = await llmService.extractInvoiceData({
    ocrText: ocrPre.compacted,
    rawOcrText: rawOcrText,
    file,
    requestId: metadata.requestId || null,
    lineItemRows: table.items,
    taxRows: taxTable.taxRows || []
  });
  const validationResult = await validationService.validateInvoiceData(extractionResult.data);
  const integrationReadiness = khatarioIntegrationService.getReadiness({ validationResult });

  return {
    requestId: metadata.requestId || null,
    file: toPublicFileMetadata(file),
    ocr: {
      provider: ocrResult.provider,
      rawText: rawOcrText,
      textBlocks: ocrResult.textBlocks || [],
      confidenceScores: ocrResult.confidenceScores || [],
      confidence: ocrResult.confidence ?? null,
      textPreview: rawOcrText.slice(0, 500),
      pages: ocrResult.pages || [],
      metadata: ocrResult.metadata || {}
    },
    extraction: {
      provider: extractionResult.provider,
      model: extractionResult.model,
      data: extractionResult.data,
      confidence: extractionResult.confidence,
      validation: extractionResult.validation,
      metadata: extractionResult.metadata,
      debug: env.debugMode ? {
        ...extractionResult.debug,
        ocrRaw: ocrPre.raw,
        ocrCleaned: ocrPre.cleaned,
        ocrCompacted: ocrPre.compacted,
        compactMode: env.ocr.compactMode,
        ocrTextBlocks: ocrResult.textBlocks || [],
        documentZoning: zoning,
        reconstructedLineItems: table.debugRows,
        reconstructedTable: {
          found: table.found,
          reason: table.reason,
          headerIndex: table.headerIndex,
          columnStrategy: table.columnStrategy,
          columns: table.columns,
          headerDetection: table.headerDetection
        },
        taxSummary: {
          found: taxTable.found,
          reason: taxTable.reason,
          headerIndex: taxTable.headerIndex,
          columns: taxTable.columns
        },
        taxRows: taxTable.taxRows || [],
        tokenMetrics: estimateTokenMetrics({
          rawOcr: ocrPre.raw,
          cleanedOcr: ocrPre.cleaned,
          compactedOcr: ocrPre.compacted,
          prompt: extractionResult.debug?.prompt || ''
        })
      } : undefined
    },
    validation: validationResult,
    integration: integrationReadiness
  };
};

export const invoiceProcessingService = {
  async processUploadedInvoice({ file, metadata }) {
    const mode = env.extraction.mode;
    const useVision = (mode === 'vision' || mode === 'auto') && isImageFile(file);

    if (useVision) {
      try {
        return await tryVisionExtraction({ file, metadata });
      } catch (visionError) {
        if (mode === 'vision') {
          throw visionError;
        }

        logger.warn({
          message: 'Vision extraction failed, falling back to OCR pipeline',
          requestId: metadata.requestId || null,
          error: visionError.message
        });
      }
    }

    return runOcrPipeline({ file, metadata });
  }
};
