import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { createSafeFilename } from '../utils/fileUtils.js';

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png'
]);

fs.mkdirSync(env.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, env.uploadDir);
  },
  filename: (_req, file, callback) => {
    callback(null, createSafeFilename(file.originalname));
  }
});

const fileFilter = (_req, file, callback) => {
  if (allowedMimeTypes.has(file.mimetype)) {
    callback(null, true);
    return;
  }

  callback(new ApiError(415, 'Unsupported invoice file type', {
    allowedTypes: [...allowedMimeTypes]
  }));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.maxFileSizeMb * 1024 * 1024,
    files: 1
  }
});

export const uploadSingleInvoice = (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      next(new ApiError(400, error.message, { code: error.code }));
      return;
    }

    next(error);
  });
};

export const resolveUploadedFilePath = (file) => path.resolve(file.path);
