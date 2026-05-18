import { env } from '../../config/env.js';
import { buildInvoiceExtractionPrompt } from '../../prompts/invoiceExtraction.prompt.js';
import { ApiError } from '../../utils/ApiError.js';
import { parseJsonObjectResponse } from '../../utils/jsonExtraction.js';
import {
  calculateInvoiceExtractionConfidence,
  validateAndNormalizeInvoiceExtraction
} from '../../utils/invoiceExtractionValidator.js';
import { logger } from '../../utils/logger.js';

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

const nowMs = () => Date.now();

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

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const getRetryDelayMs = (attempt) => Math.min(500 * 2 ** attempt, 4000);

const getOllamaGenerateUrl = () => {
  if (!env.ollama.baseUrl) {
    throw new ApiError(500, 'OLLAMA_BASE_URL is required when LLM_PROVIDER=ollama');
  }

  return `${trimTrailingSlash(env.ollama.baseUrl)}/api/generate`;
};

const fetchWithTimeout = async (url, options, timeoutMs, context = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError(504, 'Ollama request timed out', {
        timeoutMs,
        baseUrl: env.ollama.baseUrl,
        url,
        requestId: context.requestId || null
      });
    }

    throw new ApiError(502, 'Ollama request failed', {
      baseUrl: env.ollama.baseUrl,
      url,
      requestId: context.requestId || null,
      reason: error.message
    });
  } finally {
    clearTimeout(timeout);
  }
};

const parseOllamaHttpResponse = async (response) => {
  const bodyText = await response.text();
  const status = response.status;
  const responseHeaders = headersToObject(response.headers);

  if (!response.ok) {
    throw new ApiError(status >= 500 ? 502 : status, 'Ollama API returned an error', {
      status,
      headers: responseHeaders,
      bodyPreview: clampText(bodyText, 5000)
    });
  }

  try {
    const payload = JSON.parse(bodyText);
    return {
      payload,
      bodyText,
      status,
      headers: responseHeaders
    };
  } catch (error) {
    throw new ApiError(502, 'Ollama API returned invalid JSON', {
      reason: error.message,
      status,
      headers: responseHeaders,
      bodyPreview: clampText(bodyText, 5000)
    });
  }
};

const callOllamaGenerate = async ({ prompt, model, requestId }) => {
  const url = getOllamaGenerateUrl();
  const headers = {
    'content-type': 'application/json'
  };

  if (env.ollama.apiKey) {
    headers.authorization = `Bearer ${env.ollama.apiKey}`;
  }

  const bodyPayload = {
    model,
    prompt,
    stream: false,
    format: 'json',
    keep_alive: env.ollama.keepAlive,
    options: {
      temperature: 0,
      num_ctx: 4096
    }
  };
  const body = JSON.stringify(bodyPayload);
  const startedAt = nowMs();

  const requestLog = {
    provider: 'ollama',
    requestId: requestId || null,
    url,
    model,
    timeoutMs: env.ollama.timeoutMs,
    payloadBytes: Buffer.byteLength(body, 'utf8')
  };

  logger.info({ message: 'LLM outbound request', ...requestLog });

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body
    }, env.ollama.timeoutMs, { requestId });
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

  const durationMs = nowMs() - startedAt;
  const parsedHttp = await parseOllamaHttpResponse(response);
  const payload = parsedHttp.payload;

  const responseLog = {
    provider: 'ollama',
    requestId: requestId || null,
    url,
    model,
    httpStatus: parsedHttp.status,
    durationMs,
    headers: parsedHttp.headers,
    responseBody: clampText(parsedHttp.bodyText)
  };

  logger.info({
    message: 'LLM inbound response',
    ...responseLog,
    tokenUsage: {
      promptEvalCount: payload.prompt_eval_count ?? null,
      evalCount: payload.eval_count ?? null
    }
  });

  if (typeof payload.response !== 'string') {
    throw new ApiError(502, 'Ollama response is missing generated text', {
      requestId: requestId || null,
      httpStatus: parsedHttp.status,
      headers: parsedHttp.headers,
      bodyPreview: clampText(parsedHttp.bodyText, 5000),
      responseKeys: Object.keys(payload || {})
    });
  }

  return {
    content: payload.response,
    http: {
      request: requestLog,
      response: responseLog
    },
    metadata: {
      model: payload.model || model,
      totalDuration: payload.total_duration,
      loadDuration: payload.load_duration,
      promptEvalCount: payload.prompt_eval_count,
      evalCount: payload.eval_count,
      doneReason: payload.done_reason
    }
  };
};

export const extractInvoiceDataWithOllama = async (rawText, options = {}) => {
  const model = options.model || env.ollama.model || 'phi3';
  const maxAttempts = (options.retries ?? env.ollama.retries) + 1;
  const requestId = options.requestId || null;
  const lineItemRows = options.lineItemRows || null;
  const taxRows = options.taxRows || null;
  let previousError = '';
  let lastError = null;
  let lastDebug = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const prompt = buildInvoiceExtractionPrompt({ rawText, lineItemRows, taxRows, previousError });

    try {
      const response = await callOllamaGenerate({ prompt, model, requestId });
      if (env.debugMode) {
        logger.info({
          message: 'RAW LLM response before JSON parsing',
          provider: 'ollama',
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
        parsingDiagnostics: parsed.diagnostics
      } : null;
      const validation = validateAndNormalizeInvoiceExtraction(parsed.data);

      if (!validation.isValid) {
        logger.warn({
          message: 'LLM JSON parsed but validation is not valid (returning partial fields)',
          provider: 'ollama',
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

      logger.info({
        message: 'Invoice extraction completed with Ollama',
        provider: 'ollama',
        model,
        attempt: attempt + 1,
        confidence,
        warningCount: validation.issues.length
      });

      return {
        provider: 'ollama',
        model,
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
          remoteBaseUrl: env.ollama.baseUrl,
          ...response.metadata
        },
        debug: env.debugMode ? lastDebug : undefined
      };
    } catch (error) {
      lastError = error;
      previousError = error.details?.reason || error.message;
      if (env.debugMode && lastDebug && error instanceof ApiError) {
        error.details = {
          ...error.details,
          debug: lastDebug
        };
      }

      logger.warn({
        message: 'Ollama invoice extraction attempt failed',
        provider: 'ollama',
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

  throw new ApiError(502, 'Ollama failed to return valid invoice JSON', {
    attempts: maxAttempts,
    lastError: lastError?.message,
    lastDetails: lastError?.details
  });
};
