import { sendSuccess } from '../utils/apiResponse.js';
import { env } from '../config/env.js';
import { fetchOllamaTags } from '../services/llm/ollamaHealth.service.js';
import { fetchGroqModels } from '../services/llm/groq.service.js';

export const llmHealth = async (req, res, next) => {
  try {
    if (env.llm.provider === 'ollama') {
      const result = await fetchOllamaTags({ requestId: req.id });
      sendSuccess(res, {
        statusCode: 200,
        message: 'LLM health check successful',
        data: {
          ok: true,
          ...result
        }
      });
      return;
    }

    if (env.llm.provider === 'groq') {
      const result = await fetchGroqModels({ requestId: req.id });
      sendSuccess(res, {
        statusCode: 200,
        message: 'LLM health check successful',
        data: {
          ok: true,
          ...result
        }
      });
      return;
    }

    sendSuccess(res, {
      statusCode: 200,
      message: 'LLM provider is not configured for health checks',
      data: {
        provider: env.llm.provider,
        ok: true
      }
    });
  } catch (error) {
    next(error);
  }
};
