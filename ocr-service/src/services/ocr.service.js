import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { runPaddleOcr } from '../utils/ocr/paddleOcrRunner.js';

export const ocrService = {
  async extractTextFromInvoice(file) {
    if (env.ocr.provider === 'stub') {
      return {
        provider: 'stub',
        rawText: [
          `Stub OCR output for ${file.originalname}.`,
          'Set OCR_PROVIDER=paddleocr and install requirements-ocr.txt to use PaddleOCR.'
        ].join(' '),
        textBlocks: [],
        confidenceScores: [],
        confidence: null,
        text: [
          `Stub OCR output for ${file.originalname}.`,
          'Set OCR_PROVIDER=paddleocr and install requirements-ocr.txt to use PaddleOCR.'
        ].join(' ')
      };
    }

    if (env.ocr.provider === 'paddleocr') {
      return runPaddleOcr(file);
    }

    throw new ApiError(500, `OCR provider is not implemented: ${env.ocr.provider}`);
  }
};
