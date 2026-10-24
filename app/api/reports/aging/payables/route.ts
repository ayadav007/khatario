import { NextRequest } from 'next/server';
import { handleAgingReport } from '@/lib/reports/aging-report-route';

export const dynamic = 'force-dynamic';

/** GET /api/reports/aging/payables — see handleAgingReport. */
export async function GET(request: NextRequest) {
  return handleAgingReport(request, 'supplier');
}
