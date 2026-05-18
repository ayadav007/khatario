import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

const getOllamaBaseUrl = () => {
  if (!env.ollama.baseUrl) {
    throw new ApiError(500, 'OLLAMA_BASE_URL is required when LLM_PROVIDER=ollama');
  }
  return trimTrailingSlash(env.ollama.baseUrl);
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

export const fetchOllamaTags = async ({ requestId } = {}) => {
  const baseUrl = getOllamaBaseUrl();
  const url = `${baseUrl}/api/tags`;
  const startedAt = Date.now();

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: requestId ? { 'x-request-id': String(requestId) } : undefined
    });
  } catch (error) {
    throw new ApiError(502, 'Unable to reach Ollama API', {
      requestId: requestId || null,
      url,
      reason: error.message
    });
  }

  const durationMs = Date.now() - startedAt;
  const bodyText = await response.text();
  const headers = headersToObject(response.headers);

  if (!response.ok) {
    throw new ApiError(response.status >= 500 ? 502 : response.status, 'Ollama tags request failed', {
      requestId: requestId || null,
      url,
      status: response.status,
      durationMs,
      headers,
      bodyPreview: bodyText.slice(0, 5000)
    });
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch (error) {
    throw new ApiError(502, 'Ollama tags returned invalid JSON', {
      requestId: requestId || null,
      url,
      durationMs,
      headers,
      reason: error.message,
      bodyPreview: bodyText.slice(0, 5000)
    });
  }

  const models = Array.isArray(payload?.models)
    ? payload.models.map((model) => ({
      name: model?.name ?? null,
      modified_at: model?.modified_at ?? null,
      size: model?.size ?? null
    }))
    : [];

  logger.info({
    message: 'LLM health check: tags fetched',
    provider: 'ollama',
    requestId: requestId || null,
    url,
    status: response.status,
    durationMs,
    modelCount: models.length
  });

  return {
    provider: 'ollama',
    url,
    status: response.status,
    durationMs,
    headers,
    models
  };
};
