import { env } from '../config/env.js';
import { buildInvoiceExtractionPrompt } from '../prompts/invoiceExtraction.prompt.js';
import { ApiError } from '../utils/ApiError.js';
import {
  calculateInvoiceExtractionConfidence,
  validateAndNormalizeInvoiceExtraction
} from '../utils/invoiceExtractionValidator.js';
import { extractInvoiceDataWithOllama } from './llm/ollama.service.js';
import { extractInvoiceDataWithGroq } from './llm/groq.service.js';
import { extractInvoiceDataWithRules } from './llm/rules.service.js';

const extractInvoiceDataWithStub = async (rawText) => {
  const prompt = buildInvoiceExtractionPrompt({ rawText });
  const data = {
    vendor_name: null,
    invoice_number: null,
    gst_number: null,
    invoice_date: null,
    subtotal: null,
    cgst: null,
    sgst: null,
    igst: null,
    total: null,
    line_items: []
  };
  const validation = validateAndNormalizeInvoiceExtraction(data);

  return {
    provider: 'stub',
    model: env.llm.model,
    promptVersion: 'invoice-extraction-strict-json-v2',
    data,
    confidence: validation.confidence ?? calculateInvoiceExtractionConfidence({
      data,
      validationIssues: validation.issues
    }),
    validation,
    metadata: {
      rawPromptLength: prompt.length,
      attempts: 0
    }
  };
};

export const extractInvoiceData = async (rawText, options = {}) => {
  if (env.llm.provider === 'stub') {
    return extractInvoiceDataWithStub(rawText);
  }

  if (env.llm.provider === 'rules') {
    return extractInvoiceDataWithRules(rawText, options);
  }

  if (env.llm.provider === 'ollama') {
    return extractInvoiceDataWithOllama(rawText, options);
  }

  if (env.llm.provider === 'groq') {
    return extractInvoiceDataWithGroq(rawText, options);
  }

  throw new ApiError(500, `LLM provider is not implemented: ${env.llm.provider}`);
};

export const llmService = {
  async extractInvoiceData({ ocrText, rawOcrText, requestId, file, lineItemRows, taxRows }) {
    return extractInvoiceData(ocrText, { rawOcrText, requestId, file, lineItemRows, taxRows });
  }
};
