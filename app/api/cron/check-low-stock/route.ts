import { NextRequest, NextResponse } from 'next/server';
import { checkLowStockForAllBusinesses } from '@/lib/low-stock-checker';
import { assertCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/check-low-stock
 * Periodic check for buyer items at or below their reorder level (see lib/low-stock-checker)
 * Can be triggered by cron job or manually
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  try {
    const stats = await checkLowStockForAllBusinesses();
    return NextResponse.json({
      success: true,
      message: 'Low stock check completed',
      stats,
    });

  } catch (error: any) {
    console.error('Error checking low stock:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check low stock' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/check-low-stock
 * Test endpoint to manually trigger check
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

