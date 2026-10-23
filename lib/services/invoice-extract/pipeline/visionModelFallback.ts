/**
 * Model lists + dead-model skipping for the invoice vision providers.
 *
 * Providers retire model IDs (Gemini 2.0 Flash, Groq Llama 4 Scout) and the old
 * ID then answers 404 / model_not_found. Each provider gets an ordered list of
 * models; a retired one is skipped for an hour and the next one is tried.
 */

/** Gemini 2.0 Flash was shut down 2026-06-01; Google's replacement is 3.6 Flash. */
export const DEFAULT_GEMINI_VISION_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];

/** Llama 4 Scout was shut down 2026-07-17; Qwen 3.8 27B is Groq's GA vision model. */
export const DEFAULT_GROQ_VISION_MODELS = ['qwen/qwen3.8-27b'];

const DEAD_MODEL_TTL_MS = 60 * 60 * 1000;

export type VisionProviderName = 'gemini' | 'groq';

type Env = Record<string, string | undefined>;

export function parseModelList(list: string | undefined, single: string | undefined, defaults: string[]): string[] {
  const fromList = (list || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const picked = fromList.length ? fromList : single?.trim() ? [single.trim()] : defaults;
  return Array.from(new Set(picked));
}

export function geminiVisionModels(env: Env = process.env): string[] {
  return parseModelList(env.GEMINI_MODELS, env.GEMINI_MODEL, DEFAULT_GEMINI_VISION_MODELS);
}

export function groqVisionModels(env: Env = process.env): string[] {
  return parseModelList(env.GROQ_VISION_MODELS, env.GROQ_VISION_MODEL, DEFAULT_GROQ_VISION_MODELS);
}

/** Non-2xx answer from a provider's HTTP API. */
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: VisionProviderName,
    readonly model: string,
    readonly status: number,
    readonly body: string,
  ) {
    const label = provider === 'gemini' ? 'Gemini' : 'Groq Vision';
    super(`${label} API error (${status}) [${model}]: ${body.slice(0, 500)}`);
    this.name = 'ProviderHttpError';
  }
}

/** The model ID no longer exists (retired, renamed, or never available to this key). */
export function isModelGoneError(status: number, body: string): boolean {
  if (status === 404) return true;
  const b = body.toLowerCase();
  return (
    b.includes('model_not_found') ||
    b.includes('model_decommissioned') ||
    b.includes('decommissioned') ||
    b.includes('not found for api version') ||
    b.includes('is not supported for generatecontent') ||
    /model .* does not exist/.test(b)
  );
}

/** Errors that are specific to one model, so the next model may still work. */
function isPerModelError(err: ProviderHttpError): boolean {
  return isModelGoneError(err.status, err.body) || err.status === 400 || err.status === 429 || err.status >= 500;
}

const deadModels = new Map<string, number>();

function deadKey(provider: VisionProviderName, model: string): string {
  return `${provider}:${model}`;
}

export function markModelDead(provider: VisionProviderName, model: string, now = Date.now()): void {
  deadModels.set(deadKey(provider, model), now + DEAD_MODEL_TTL_MS);
}

export function isModelDead(provider: VisionProviderName, model: string, now = Date.now()): boolean {
  const until = deadModels.get(deadKey(provider, model));
  if (until === undefined) return false;
  if (until <= now) {
    deadModels.delete(deadKey(provider, model));
    return false;
  }
  return true;
}

export function resetDeadModelsForTests(): void {
  deadModels.clear();
}

/** Every model of one provider failed; message lists each model's reason. */
export class VisionModelsExhaustedError extends Error {
  constructor(
    readonly provider: VisionProviderName,
    readonly failures: Array<{ model: string; error: string }>,
  ) {
    super(failures.map((f) => `[${f.model}] ${f.error}`).join(' ; '));
    this.name = 'VisionModelsExhaustedError';
  }
}

/**
 * Runs `attempt` with each configured model in order. Retired models are marked
 * dead for an hour; quota / overload / bad-request errors move on without marking.
 * Timeouts and unreadable answers stop here so the next provider gets a turn.
 * If every model is marked dead they are all tried again rather than giving up.
 */
export async function runWithModelFallback<T>(
  provider: VisionProviderName,
  models: string[],
  attempt: (model: string) => Promise<T>,
): Promise<T> {
  const live = models.filter((m) => !isModelDead(provider, m));
  const order = live.length ? live : models;
  const failures: Array<{ model: string; error: string }> = [];

  for (const model of order) {
    try {
      return await attempt(model);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ model, error: message });
      if (!(err instanceof ProviderHttpError) || !isPerModelError(err)) break;
      if (isModelGoneError(err.status, err.body)) {
        markModelDead(provider, model);
        console.warn(`[invoices/extract] ${provider} model ${model} is gone (HTTP ${err.status}); skipping it for 1h.`);
      } else {
        console.warn(`[invoices/extract] ${provider} model ${model} failed (HTTP ${err.status}); trying next model.`);
      }
    }
  }

  throw new VisionModelsExhaustedError(provider, failures);
}
