import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';

let envLoaded = false;

/** Next may boot before keys are added to .env files; workers and scripts run outside Next. */
function loadAssistantEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  for (const file of ['.env.local', '.env', '.env.production']) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) loadEnv({ path, override: false });
  }
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const EMBEDDING_DIMENSIONS = 768;

export interface RagConfig {
  enabled: boolean;
  groqKey: string;
  geminiKey: string;
  answerModel: string;
  rewriteModel: string;
  geminiChatModel: string;
  embedModel: string;
  dailyTokenBudget: number;
  retentionDays: number;
  /** Cosine similarity that alone counts as a confident vector hit. */
  minVectorSimilarity: number;
  /** Share of meaningful query terms that must appear in a top chunk (keyword-only confidence). */
  minTermCoverage: number;
  maxMessageChars: number;
  topK: number;
  candidatesPerMethod: number;
}

export function ragConfig(): RagConfig {
  loadAssistantEnv();
  return {
    enabled: process.env.ASSISTANT_ENABLED !== 'false',
    groqKey: (process.env.GROQ_API_KEY || '').trim(),
    geminiKey: (process.env.GEMINI_API_KEY || '').trim(),
    answerModel: process.env.GROQ_RAG_MODEL || 'openai/gpt-oss-120b',
    rewriteModel: process.env.GROQ_REWRITE_MODEL || 'openai/gpt-oss-20b',
    geminiChatModel: process.env.ASSISTANT_GEMINI_MODEL || 'gemini-3.5-flash',
    embedModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
    dailyTokenBudget: intEnv('ASSISTANT_DAILY_TOKEN_BUDGET', 2_000_000),
    retentionDays: intEnv('ASSISTANT_RETENTION_DAYS', 90),
    minVectorSimilarity: floatEnv('ASSISTANT_MIN_VECTOR_SIMILARITY', 0.55),
    minTermCoverage: floatEnv('ASSISTANT_MIN_TERM_COVERAGE', 0.5),
    maxMessageChars: intEnv('ASSISTANT_MAX_MESSAGE_CHARS', 1000),
    topK: intEnv('ASSISTANT_TOP_K', 6),
    candidatesPerMethod: intEnv('ASSISTANT_CANDIDATES', 20),
  };
}

export function chatModelConfigured(cfg: RagConfig = ragConfig()): boolean {
  return Boolean(cfg.groqKey || cfg.geminiKey);
}
