import { env, isProduction } from './env.js';
import { ApiError } from '../utils/ApiError.js';

export const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (!isProduction && env.allowedOrigins.length === 0) {
      callback(null, true);
      return;
    }

    if (env.allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new ApiError(403, 'CORS origin not allowed'));
  },
  credentials: true
};
