#!/usr/bin/env node
/**
 * Cron-friendly entrypoint: rebuild invoice learning rollup tables when INVOICE_EXTRACTION_AGGREGATION=true.
 *
 * Example:
 *   npx dotenv-cli -e .env.local -- npx ts-node --project tsconfig.worker.json --transpile-only -r tsconfig-paths/register scripts/runInvoiceLearningAggregation.ts
 */

import 'dotenv/config';

import { runInvoiceLearningAggregationCli } from '@/lib/services/invoice-extract/learningAggregation';

runInvoiceLearningAggregationCli().then(() => process.exit(0)).catch((err) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), scope: 'invoice-learning-aggregation', ok: false, err: String(err) }));
  process.exit(1);
});
