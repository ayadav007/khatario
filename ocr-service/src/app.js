import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import invoiceRoutes from './routes/invoice.routes.js';
import debugRoutes from './routes/debug.routes.js';
import { corsOptions } from './config/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { requestLoggerStream } from './utils/logger.js';

const app = express();

app.use(requestContext);
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan('combined', { stream: requestLoggerStream }));

app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      service: 'invoice-ocr-api',
      timestamp: new Date().toISOString()
    }
  });
});

app.use('/api/invoices', invoiceRoutes);
app.use('/api/debug', debugRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
