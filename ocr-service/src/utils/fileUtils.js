import path from 'path';
import crypto from 'crypto';

export const createSafeFilename = (originalName) => {
  const extension = path.extname(originalName).toLowerCase();
  const baseName = path
    .basename(originalName, extension)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'invoice';

  const id = crypto.randomUUID();
  return `${Date.now()}-${id}-${baseName}${extension}`;
};

export const toPublicFileMetadata = (file) => ({
  originalName: file.originalname,
  storedName: file.filename,
  mimeType: file.mimetype,
  size: file.size
});
