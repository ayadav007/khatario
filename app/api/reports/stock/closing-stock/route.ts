import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import {
  getClosingStockSnapshot,
  createClosingStockSnapshot,
  listClosingStockHistory,
  fetchSnapshotLinesForExport,
  listStockAuditEntries,
  type ClosingValuationMethod,
} from '@/lib/services/closing-stock-valuator';
import { queryOne, queryRows } from '@/lib/db';
import { hasClosingStockV2Schema } from '@/lib/closing-stock-schema';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getClosingStockLockedCutoffDate } from '@/lib/closing-stock-period-lock';

function isClosingValuationMethod(s: string): s is ClosingValuationMethod {
  return s === 'fifo' || s === 'weighted_avg' || s === 'last_purchase';
}

/**
 * GET /api/reports/stock/closing-stock
 * Query: financial_year (required), snapshot_id?, page?, limit?, search?, sort?, format=csv?
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const warehouseId = searchParams.get('warehouse_id');
    const financialYear = searchParams.get('financial_year');
    const snapshotId = searchParams.get('snapshot_id') || undefined;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const search = searchParams.get('search') || undefined;
    const sort = searchParams.get('sort') || undefined;
    const format = searchParams.get('format');

    if (!businessId || !financialYear) {
      return NextResponse.json({ error: 'business_id and financial_year are required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    try {
      await assertReportAccess(businessId, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await authorize(userId, 'report.inventory', 'read', {
        businessId,
        warehouseId: warehouseId || undefined,
        resource: {
          business_id: businessId,
          warehouse_id: warehouseId || null,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (format === 'csv') {
      const buildCsvResponse = (
        meta: {
          financial_year: string;
          snapshot_date: string;
          valuation_method: string;
          total_items: number;
          total_quantity: number;
          total_value: number;
        },
        rows: Awaited<ReturnType<typeof fetchSnapshotLinesForExport>>
      ) => {
        const snapDate = meta.snapshot_date.slice(0, 10);
        const lines: string[] = [];
        lines.push('Closing Stock Snapshot (CSV)');
        lines.push(`Financial Year,${meta.financial_year}`);
        lines.push(`Snapshot Date,${snapDate}`);
        lines.push(`Valuation Method,${meta.valuation_method || ''}`);
        lines.push(`Total Items,${meta.total_items}`);
        lines.push(`Total Quantity,${meta.total_quantity}`);
        lines.push(`Total Value,${meta.total_value}`);
        lines.push('');
        lines.push('Item Name,Quantity,Valuation Price,Total Value,Last Purchase Date');
        for (const row of rows) {
          lines.push(
            [
              `"${(row.item_name || '').replace(/"/g, '""')}"`,
              row.quantity,
              row.unit_cost,
              row.total_value,
              row.last_purchase_date || '',
            ].join(',')
          );
        }
        lines.push('');
        lines.push('--- Summary (totals) ---');
        lines.push(`Total Items,${meta.total_items}`);
        lines.push(`Total Quantity,${meta.total_quantity}`);
        lines.push(`Total Value,${meta.total_value}`);
        lines.push(`Financial Year,${meta.financial_year}`);
        lines.push(`Snapshot Date,${snapDate}`);
        lines.push(`Valuation Method,${meta.valuation_method || ''}`);
        return new NextResponse(lines.join('\n'), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="closing-stock-${snapDate}.csv"`,
          },
        });
      };

      if (!(await hasClosingStockV2Schema())) {
        const snap = await getClosingStockSnapshot(businessId, financialYear, {
          page: 1,
          limit: 100_000,
          forExport: true,
          sort: 'name',
        });
        if (!snap.summary && snap.snapshots.length === 0) {
          return NextResponse.json({ error: 'No snapshot to export' }, { status: 404 });
        }
        const s = snap.summary;
        const meta = {
          financial_year: financialYear,
          snapshot_date: s?.snapshot_date || new Date().toISOString().slice(0, 10),
          valuation_method: String(s?.valuation_method || ''),
          total_items: s?.total_items ?? snap.snapshots.length,
          total_quantity: s?.total_quantity ?? 0,
          total_value: s?.total_value ?? 0,
        };
        return buildCsvResponse(meta, snap.snapshots);
      }

      let headerId = snapshotId;
      if (!headerId) {
        const h = await queryOne<{ id: string }>(
          `SELECT id FROM closing_stock_snapshot_headers
           WHERE business_id = $1 AND financial_year = $2
           ORDER BY snapshot_date DESC, created_at DESC
           LIMIT 1`,
          [businessId, financialYear]
        );
        headerId = h?.id;
      }
      if (!headerId) {
        return NextResponse.json({ error: 'No snapshot to export' }, { status: 404 });
      }
      const meta = await queryOne<{
        financial_year: string;
        snapshot_date: Date;
        valuation_method: string;
        total_items: number;
        total_quantity: number;
        total_value: number;
      }>(
        `SELECT financial_year, snapshot_date, valuation_method, total_items, total_quantity, total_value
         FROM closing_stock_snapshot_headers WHERE id = $1 AND business_id = $2`,
        [headerId, businessId]
      );
      if (!meta) {
        return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
      }
      const rows = await fetchSnapshotLinesForExport(headerId, businessId);
      const snapDate =
        meta.snapshot_date instanceof Date
          ? meta.snapshot_date.toISOString().slice(0, 10)
          : String(meta.snapshot_date).slice(0, 10);
      return buildCsvResponse(
        {
          financial_year: meta.financial_year,
          snapshot_date: snapDate,
          valuation_method: meta.valuation_method || '',
          total_items: meta.total_items,
          total_quantity: Number(meta.total_quantity),
          total_value: Number(meta.total_value),
        },
        rows
      );
    }

    const snapshot = await getClosingStockSnapshot(businessId, financialYear, {
      snapshotId,
      page,
      limit,
      search,
      sort,
    });

    const history = await listClosingStockHistory(businessId);

    let auditEntries: Awaited<ReturnType<typeof listStockAuditEntries>> = [];
    if (snapshot.summary?.snapshot_header_id) {
      auditEntries = await listStockAuditEntries(snapshot.summary.snapshot_header_id, businessId);
    }

    const cutoffDate = await getClosingStockLockedCutoffDate(businessId);

    return NextResponse.json({
      ...snapshot,
      history,
      auditEntries,
      inventory_lock: { cutoff_date: cutoffDate },
    });
  } catch (error: any) {
    console.error('Error fetching closing stock:', error);
    return NextResponse.json(
      { error: 'Failed to fetch closing stock', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reports/stock/closing-stock
 * Body: business_id, financial_year, snapshot_date, valuation_method (fifo|weighted_avg|last_purchase), user_id, location_id?, branch_id?
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, financial_year, snapshot_date, location_id, branch_id } = body;
    const rawMethod = (body.valuation_method || 'weighted_avg') as string;
    const userId = getUserIdFromRequest(request, body);

    if (!business_id || !financial_year || !snapshot_date) {
      return NextResponse.json(
        { error: 'business_id, financial_year, and snapshot_date are required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    if (!isClosingValuationMethod(rawMethod)) {
      return NextResponse.json(
        { error: 'valuation_method must be fifo, weighted_avg, or last_purchase' },
        { status: 400 }
      );
    }

    try {
      await assertReportAccess(business_id, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await authorize(userId, 'report.inventory', 'read', {
        businessId: business_id,
        resource: { business_id },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const financialYear = await queryOne<{ id: string }>(
      `SELECT id FROM financial_years
       WHERE business_id = $1 AND year_code = $2`,
      [business_id, financial_year]
    );

    if (!financialYear) {
      const registered = await queryRows<{ year_code: string }>(
        `SELECT year_code FROM financial_years
         WHERE business_id = $1
         ORDER BY start_date DESC`,
        [business_id]
      );
      const registered_year_codes = registered.map((r) => r.year_code);
      const requested = String(financial_year);
      return NextResponse.json(
        {
          error: `No financial year is registered for "${requested}". Add this year to your business first, or pick an existing year code.`,
          code: 'FINANCIAL_YEAR_NOT_FOUND',
          requested_year_code: requested,
          registered_year_codes,
          help: {
            what:
              'A financial year is your official accounting period (in India this is usually 1 April to 31 March). It is identified by a short code such as 2026-2027.',
            why:
              'Closing stock snapshots are saved against a financial year so inventory value matches your books, GST returns, and year-end reports. The app only accepts year codes that already exist for your business.',
            how_to_fix:
              registered_year_codes.length > 0
                ? `Use one of the year codes already registered for this business (see list below), or ask an administrator to add "${requested}" with the correct start and end dates. The code must match exactly—including dashes and digits.`
                : `No financial years exist for this business yet. Ask an administrator to create the first financial year (with start and end dates) before you can run closing stock. This is normally done during company setup.`,
          },
        },
        { status: 404 }
      );
    }

    const summary = await createClosingStockSnapshot(
      business_id,
      financialYear.id,
      financial_year,
      snapshot_date,
      rawMethod,
      userId,
      location_id,
      branch_id || null
    );

    const snapshot = await getClosingStockSnapshot(business_id, financial_year, {
      snapshotId: summary.snapshot_header_id || undefined,
      page: 1,
      limit: 50,
    });

    const history = await listClosingStockHistory(business_id);
    const cutoffDate = await getClosingStockLockedCutoffDate(business_id);
    let auditEntries: Awaited<ReturnType<typeof listStockAuditEntries>> = [];
    if (snapshot.summary?.snapshot_header_id) {
      auditEntries = await listStockAuditEntries(snapshot.summary.snapshot_header_id, business_id);
    }

    return NextResponse.json({
      summary: snapshot.summary,
      snapshots: snapshot.snapshots,
      pagination: snapshot.pagination,
      comparison: snapshot.comparison,
      history,
      auditEntries,
      inventory_lock: { cutoff_date: cutoffDate },
    });
  } catch (error: any) {
    console.error('Error creating closing stock snapshot:', error);
    return NextResponse.json(
      { error: 'Failed to create closing stock snapshot', details: error.message },
      { status: 500 }
    );
  }
}
