import { ApiError } from '../utils/ApiError.js';
import { isProduction } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const errorHandler = (error, req, res, _next) => {
  const statusCode = error instanceof ApiError ? error.statusCode : 500;
  const message = statusCode === 500 && isProduction
    ? 'Internal server error'
    : error.message || 'Internal server error';

  logger.error({
    message: error.message,
    statusCode,
    path: req.originalUrl,
    method: req.method,
    stack: error.stack
  });

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      statusCode,
      details: error.details || undefined
    }
  });
};
