import app from './app.js';
import { env } from './config/env.js';
import { cleanupTempUploads } from './utils/cleanupUploads.js';
import { logger } from './utils/logger.js';
import { validateLlmStartup } from './utils/llmStartupValidation.js';

const server = app.listen(env.port, () => {
  logger.info(`Invoice OCR API listening on port ${env.port}`);
  validateLlmStartup().catch((error) => {
    logger.error({ message: 'LLM startup validation crashed', error: error.message });
  });
});

const runCleanup = () => {
  cleanupTempUploads().catch((error) => {
    logger.warn({ message: 'Temporary upload cleanup failed', error: error.message });
  });
};

runCleanup();
const cleanupInterval = setInterval(runCleanup, 15 * 60 * 1000);

const shutdown = (signal) => {
  logger.info(`${signal} received. Closing HTTP server.`);
  clearInterval(cleanupInterval);
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
