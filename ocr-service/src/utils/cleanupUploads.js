import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const cleanupTempUploads = async () => {
  const uploadDir = path.resolve(env.uploadDir);
  const retentionMs = env.uploadRetentionMinutes * 60 * 1000;
  const cutoff = Date.now() - retentionMs;

  let entries = [];
  try {
    entries = await fs.readdir(uploadDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn({ message: 'Unable to read upload directory', error: error.message });
    }
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || entry.name === '.gitkeep') return;

    try {
      const filePath = path.join(uploadDir, entry.name);
      const stat = await fs.stat(filePath);

      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        logger.info({ message: 'Deleted expired temporary upload', file: entry.name });
      }
    } catch (error) {
      logger.warn({
        message: 'Unable to inspect temporary upload',
        file: entry.name,
        error: error.message
      });
    }
  }));
};
