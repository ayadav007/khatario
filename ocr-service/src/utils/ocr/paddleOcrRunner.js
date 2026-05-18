import path from 'path';
import { env } from '../../config/env.js';
import { ApiError } from '../ApiError.js';
import { runJsonSubprocess } from '../subprocessJson.js';

const supportedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png'
]);

const toBooleanFlag = (value) => (value ? ['--use-gpu'] : []);

export const runPaddleOcr = async (file) => {
  if (!supportedMimeTypes.has(file.mimetype)) {
    throw new ApiError(415, 'Unsupported file type for PaddleOCR', {
      mimeType: file.mimetype,
      supportedMimeTypes: [...supportedMimeTypes]
    });
  }

  const scriptPath = path.resolve(env.ocr.scriptPath);
  const filePath = path.resolve(file.path);
  const args = [
    scriptPath,
    '--file',
    filePath,
    '--lang',
    env.ocr.lang,
    '--page-limit',
    String(env.ocr.pageLimit),
    ...toBooleanFlag(env.ocr.useGpu)
  ];

  const result = await runJsonSubprocess({
    command: env.ocr.pythonPath,
    args,
    timeoutMs: env.ocr.timeoutMs
  });

  if (!Array.isArray(result.textBlocks) || typeof result.rawText !== 'string') {
    throw new ApiError(502, 'PaddleOCR returned an unexpected response shape', {
      keys: Object.keys(result || {})
    });
  }

  return {
    provider: 'paddleocr',
    rawText: result.rawText,
    text: result.rawText,
    textBlocks: result.textBlocks,
    confidenceScores: result.confidenceScores || [],
    confidence: result.confidence ?? null,
    pages: result.pages || [],
    metadata: result.metadata || {}
  };
};
