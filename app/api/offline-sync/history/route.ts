import { NextRequest, NextResponse } from 'next/server';
import { getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  listReplayLogsForBusiness,
  countReplayMetrics,
} from '@/lib/offline-sync/replay-log-repository';
import {
  listInvoiceNumberMappings,
  countInvoiceMappings,
} from '@/lib/offline-sync/invoice-number-map-repository';

export async function GET(request: NextRequest) {
  try {
    const businessId = getSessionScopedBusinessId(request);
    if (!businessId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = request.nextUrl.searchParams.get('user_id');
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'invoices', 'create', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const limit = Math.min(
      100,
      Math.max(1, Number(request.nextUrl.searchParams.get('limit') || 50))
    );

    const [logs, metrics, invoiceMappings, mappingCount] = await Promise.all([
      listReplayLogsForBusiness(businessId, limit),
      countReplayMetrics(businessId),
      listInvoiceNumberMappings(businessId, limit),
      countInvoiceMappings(businessId),
    ]);

    return NextResponse.json({
      logs,
      metrics: {
        ...metrics,
        gst_conflicts: metrics.manualReview,
        invoice_number_mappings: mappingCount,
      },
      invoice_number_mappings: invoiceMappings,
    });
  } catch (error) {
    console.error('[offline-sync/history]', error);
    return NextResponse.json({ error: 'Failed to load replay history' }, { status: 500 });
  }
}
