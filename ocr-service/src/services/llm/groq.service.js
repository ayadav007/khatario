import { env } from '../../config/env.js';
import { buildInvoiceExtractionPrompt } from '../../prompts/invoiceExtraction.prompt.js';
import { ApiError } from '../../utils/ApiError.js';
import { parseJsonObjectResponse } from '../../utils/jsonExtraction.js';
import {
  calculateInvoiceExtractionConfidence,
  validateAndNormalizeInvoiceExtraction
} from '../../utils/invoiceExtractionValidator.js';
import { logger } from '../../utils/logger.js';

const clampText = (value, maxChars = 20000) => {
  if (typeof value !== 'string') return '';
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars);
};

const headersToObject = (headers) => {
  const result = {};
  try {
    headers.forEach((value, key) => {
      result[key] = value;
    });
  } catch {
    return {};
  }
  return result;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getRetryDelayMs = (attempt) => Math.min(500 * 2 ** attempt, 4000);

const getGroqChatCompletionsUrl = () => `${env.groq.baseUrl}/chat/completions`;
const getGroqModelsUrl = () => `${env.groq.baseUrl}/models`;

const fetchWithTimeout = async (url, options, timeoutMs, context = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError(504, 'Groq request timed out', {
        timeoutMs,
        url,
        requestId: context.requestId || null
      });
    }
    throw new ApiError(502, 'Groq request failed', {
      url,
      requestId: context.requestId || null,
      reason: error.message
    });
  } finally {
    clearTimeout(timeout);
  }
};

const parseJsonHttpBody = (bodyText, meta) => {
  try {
    return JSON.parse(bodyText);
  } catch (error) {
    throw new ApiError(502, 'Groq API returned invalid JSON', {
      ...meta,
      reason: error.message,
      bodyPreview: clampText(bodyText, 5000)
    });
  }
};

const callGroqChatCompletions = async ({ prompt, model, requestId }) => {
  if (!env.groq.apiKey) {
    throw new ApiError(500, 'GROQ_API_KEY is required when LLM_PROVIDER=groq');
  }
  if (!model) {
    throw new ApiError(500, 'GROQ_MODEL is required when LLM_PROVIDER=groq');
  }

  const url = getGroqChatCompletionsUrl();
  const startedAt = Date.now();

  const bodyPayload = {
    model,
    messages: [
      { role: 'user', content: prompt }
    ],
    temperature: 0
  };
  const body = JSON.stringify(bodyPayload);

  const requestLog = {
    provider: 'groq',
    requestId: requestId || null,
    url,
    model,
    timeoutMs: env.llm.timeoutMs,
    payloadBytes: Buffer.byteLength(body, 'utf8')
  };

  logger.info({ message: 'LLM outbound request', ...requestLog });

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.groq.apiKey}`
      },
      body
    }, env.llm.timeoutMs, { requestId });
  } catch (error) {
    if (error instanceof ApiError) {
      logger.error({
        message: 'LLM request failed',
        ...requestLog,
        error: error.message,
        details: error.details
      });
    }
    throw error;
  }

  const durationMs = Date.now() - startedAt;
  const bodyText = await response.text();
  const responseHeaders = headersToObject(response.headers);

  const responseLog = {
    provider: 'groq',
    requestId: requestId || null,
    url,
    model,
    httpStatus: response.status,
    durationMs,
    headers: responseHeaders,
    responseBody: clampText(bodyText)
  };

  if (!response.ok) {
    const payload = parseJsonHttpBody(bodyText, {
      requestId: requestId || null,
      url,
      status: response.status,
      headers: responseHeaders,
      durationMs
    });
    throw new ApiError(response.status >= 500 ? 502 : response.status, 'Groq API returned an error', {
      requestId: requestId || null,
      url,
      status: response.status,
      headers: responseHeaders,
      durationMs,
      errorPayload: payload
    });
  }

  const payload = parseJsonHttpBody(bodyText, {
    requestId: requestId || null,
    url,
    status: response.status,
    headers: responseHeaders,
    durationMs
  });

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ApiError(502, 'Groq response is missing generated text', {
      requestId: requestId || null,
      url,
      status: response.status,
      headers: responseHeaders,
      durationMs,
      responseKeys: Object.keys(payload || {})
    });
  }

  const tokenUsage = payload?.usage
    ? {
      promptTokens: payload.usage.prompt_tokens ?? null,
      completionTokens: payload.usage.completion_tokens ?? null,
      totalTokens: payload.usage.total_tokens ?? null
    }
    : null;

  logger.info({
    message: 'LLM inbound response',
    ...responseLog,
    tokenUsage
  });

  return {
    content,
    http: {
      request: requestLog,
      response: responseLog
    },
    usage: tokenUsage,
    metadata: {
      model: payload?.model || model
    }
  };
};

export const fetchGroqModels = async ({ requestId } = {}) => {
  if (!env.groq.apiKey) {
    throw new ApiError(500, 'GROQ_API_KEY is required when LLM_PROVIDER=groq');
  }
  const url = getGroqModelsUrl();
  const startedAt = Date.now();
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${env.groq.apiKey}`
    }
  }, env.llm.timeoutMs, { requestId });
  const durationMs = Date.now() - startedAt;
  const bodyText = await response.text();
  const headers = headersToObject(response.headers);

  if (!response.ok) {
    throw new ApiError(response.status >= 500 ? 502 : response.status, 'Groq models request failed', {
      requestId: requestId || null,
      url,
      status: response.status,
      durationMs,
      headers,
      bodyPreview: clampText(bodyText, 5000)
    });
  }

  const payload = parseJsonHttpBody(bodyText, {
    requestId: requestId || null,
    url,
    status: response.status,
    durationMs,
    headers
  });

  const models = Array.isArray(payload?.data)
    ? payload.data.map((item) => ({
      id: item?.id ?? null,
      owned_by: item?.owned_by ?? null
    }))
    : [];

  return {
    provider: 'groq',
    url,
    status: response.status,
    durationMs,
    headers,
    models
  };
};

export const extractInvoiceDataWithGroq = async (rawText, options = {}) => {
  const model = options.model || env.groq.model;
  const maxAttempts = (options.retries ?? env.llm.retries) + 1;
  const requestId = options.requestId || null;
  const lineItemRows = options.lineItemRows || null;
  const taxRows = options.taxRows || null;

  let previousError = '';
  let lastError = null;
  let lastDebug = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt = buildInvoiceExtractionPrompt({ rawText, lineItemRows, taxRows, previousError });

    try {
      const response = await callGroqChatCompletions({ prompt, model, requestId });

      if (env.debugMode) {
        logger.info({
          message: 'RAW LLM response before JSON parsing',
          provider: 'groq',
          model,
          attempt: attempt + 1,
          requestId,
          rawResponse: response.content
        });
      }

      const parsed = parseJsonObjectResponse(response.content, { debug: env.debugMode });
      lastDebug = env.debugMode ? {
        ocrText: rawText,
        prompt,
        llmRequest: response.http?.request,
        llmResponse: response.http?.response,
        rawLlmResponse: parsed.diagnostics?.rawResponse ?? response.content,
        sanitizedJson: parsed.sanitized,
        parsedJson: parsed.data,
        parsingDiagnostics: parsed.diagnostics,
        tokenUsage: response.usage,
        latencyMs: response.http?.response?.durationMs
      } : null;

      const validation = validateAndNormalizeInvoiceExtraction(parsed.data);
      if (!validation.isValid) {
        logger.warn({
          message: 'LLM JSON parsed but validation is not valid (returning partial fields)',
          provider: 'groq',
          model,
          requestId,
          status: validation.status,
          issueCount: validation.issues.length,
          errors: validation.errors.length
        });
      }

      const confidence = validation.confidence ?? calculateInvoiceExtractionConfidence({
        data: validation.data,
        validationIssues: validation.issues
      });

      return {
        provider: 'groq',
        model: response.metadata?.model || model,
        promptVersion: 'invoice-extraction-strict-json-v2',
        data: validation.data,
        confidence,
        validation: {
          status: validation.status,
          isValid: validation.isValid,
          confidence,
          issues: validation.issues,
          warnings: validation.warnings,
          errors: validation.errors
        },
        metadata: {
          attempts: attempt + 1,
          tokenUsage: response.usage,
          latencyMs: response.http?.response?.durationMs ?? null
        },
        debug: env.debugMode ? lastDebug : undefined
      };
    } catch (error) {
      lastError = error;
      previousError = error.details?.reason || error.message;

      if (env.debugMode && lastDebug && error instanceof ApiError) {
        error.details = { ...error.details, debug: lastDebug };
      }

      logger.warn({
        message: 'Groq invoice extraction attempt failed',
        provider: 'groq',
        model,
        attempt: attempt + 1,
        maxAttempts,
        requestId,
        error: error.message,
        details: error.details
      });

      if (attempt < maxAttempts - 1) {
        await sleep(getRetryDelayMs(attempt));
      }
    }
  }

  throw new ApiError(502, 'Groq failed to return valid invoice JSON', {
    attempts: maxAttempts,
    lastError: lastError?.message,
    lastDetails: lastError?.details
  });
};
