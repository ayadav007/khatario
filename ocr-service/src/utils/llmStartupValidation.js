import { env } from '../config/env.js';
import { logger } from './logger.js';
import { fetchOllamaTags } from '../services/llm/ollamaHealth.service.js';
import { fetchGroqModels } from '../services/llm/groq.service.js';

const normalizeModelName = (value) => String(value || '').trim().toLowerCase();

export const validateLlmStartup = async () => {
  if (env.llm.provider !== 'ollama') {
    if (env.llm.provider !== 'groq') {
      logger.info({
        message: `LLM startup validation skipped (provider=${env.llm.provider} needs no remote check)`,
        provider: env.llm.provider
      });
      return;
    }
  }

  if (env.llm.provider === 'ollama') {
    if (!env.ollama.baseUrl) {
      logger.error({
        message: 'LLM startup validation failed: OLLAMA_BASE_URL is missing',
        provider: 'ollama'
      });
      process.exit(1);
    }

    try {
      const tags = await fetchOllamaTags({ requestId: 'startup' });
      const available = tags.models
        .map((m) => normalizeModelName(m.name))
        .filter(Boolean);
      const wanted = normalizeModelName(env.ollama.model);
      const modelExists = wanted ? available.includes(wanted) : false;

      logger.info({
        message: 'LLM startup validation complete',
        provider: 'ollama',
        baseUrl: env.ollama.baseUrl,
        configuredModel: env.ollama.model,
        modelExists,
        modelCount: tags.models.length,
        models: tags.models.map((m) => m.name).slice(0, 50)
      });

      if (wanted && !modelExists) {
        logger.warn({
          message: 'Configured Ollama model not found in tags list',
          provider: 'ollama',
          configuredModel: env.ollama.model,
          suggestion: 'Update OLLAMA_MODEL or ensure the model is pulled on the remote server.'
        });
      }
    } catch (error) {
      logger.error({
        message: 'LLM startup validation failed (connectivity)',
        provider: 'ollama',
        error: error.message,
        details: error.details
      });
    }

    return;
  }

  if (!env.groq.apiKey) {
    logger.error({
      message: 'LLM startup validation failed: GROQ_API_KEY is missing',
      provider: 'groq'
    });
    process.exit(1);
  }

  try {
    const models = await fetchGroqModels({ requestId: 'startup' });
    const available = models.models
      .map((m) => normalizeModelName(m.id))
      .filter(Boolean);
    const wanted = normalizeModelName(env.groq.model);
    const modelExists = wanted ? available.includes(wanted) : false;

    logger.info({
      message: 'LLM startup validation complete',
      provider: 'groq',
      baseUrl: env.groq.baseUrl,
      configuredModel: env.groq.model,
      modelExists,
      modelCount: models.models.length,
      models: models.models.map((m) => m.id).slice(0, 50)
    });

    if (env.groq.model && !modelExists) {
      logger.warn({
        message: 'Configured Groq model not found in models list',
        provider: 'groq',
        configuredModel: env.groq.model,
        suggestion: 'Update GROQ_MODEL to an available model id.'
      });
    }
  } catch (error) {
    logger.error({
      message: 'LLM startup validation failed (connectivity)',
      provider: 'groq',
      error: error.message,
      details: error.details
    });
  }
};
