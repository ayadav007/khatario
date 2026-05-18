import dotenv from 'dotenv';

dotenv.config();

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseList = (value) => {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseBoolean = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  debugMode: parseBoolean(process.env.OCR_DEBUG_MODE, false),
  port: parseNumber(process.env.OCR_SERVICE_PORT, 4000),
  allowedOrigins: parseList(process.env.OCR_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS),
  uploadDir: process.env.OCR_UPLOAD_DIR || 'ocr-service/uploads/tmp',
  maxFileSizeMb: parseNumber(process.env.OCR_MAX_FILE_SIZE_MB, 10),
  uploadRetentionMinutes: parseNumber(process.env.OCR_UPLOAD_RETENTION_MINUTES, 30),
  ocr: {
    provider: process.env.OCR_PROVIDER || 'paddleocr',
    apiKey: process.env.OCR_API_KEY || '',
    apiUrl: process.env.OCR_API_URL || '',
    pythonPath: process.env.OCR_PYTHON_PATH || 'ocr-service/.venv/Scripts/python.exe',
    scriptPath: process.env.OCR_SCRIPT_PATH || 'ocr-service/scripts/paddle_ocr_runner.py',
    timeoutMs: parseNumber(process.env.OCR_TIMEOUT_MS, 120000),
    lang: process.env.OCR_LANG || 'en',
    useGpu: parseBoolean(process.env.OCR_USE_GPU, false),
    pageLimit: parseNumber(process.env.OCR_PAGE_LIMIT, 5),
    compactMode: parseBoolean(process.env.OCR_COMPACT_MODE, false)
  },
  llm: {
    provider: process.env.LLM_PROVIDER || 'groq',
    apiKey: process.env.LLM_API_KEY || '',
    apiUrl: process.env.LLM_API_URL || '',
    model: process.env.LLM_MODEL || 'phi3',
    timeoutMs: parseNumber(process.env.LLM_TIMEOUT_MS, 90000),
    retries: parseNumber(process.env.LLM_RETRIES, 2)
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || '',
    model: process.env.OLLAMA_MODEL || process.env.LLM_MODEL || 'phi3',
    apiKey: process.env.OLLAMA_API_KEY || '',
    timeoutMs: parseNumber(
      process.env.OLLAMA_TIMEOUT_MS,
      parseNumber(process.env.LLM_TIMEOUT_MS, 90000)
    ),
    retries: parseNumber(
      process.env.OLLAMA_RETRIES,
      parseNumber(process.env.LLM_RETRIES, 2)
    ),
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || '5m'
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    visionModel: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'
  },
  extraction: {
    mode: process.env.EXTRACTION_MODE || 'vision'
  }
};

export const isProduction = env.nodeEnv === 'production';
