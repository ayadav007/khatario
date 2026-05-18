import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/bookings/stats
 * Get booking statistics (Admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    // Total bookings
    const total = await queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM demo_bookings
    `);

    // By status
    const byStatus = await queryRows<{ status: string; count: number }>(`
      SELECT status, COUNT(*) as count
      FROM demo_bookings
      GROUP BY status
    `);

    // By lead source
    const byLeadSource = await queryRows<{ lead_source: string; count: number }>(`
      SELECT lead_source, COUNT(*) as count
      FROM demo_bookings
      GROUP BY lead_source
    `);

    // Conversion rate
    const converted = await queryOne<{ count: number }>(`
      SELECT COUNT(*) as count 
      FROM demo_bookings 
      WHERE status = 'converted'
    `);

    const conversionRate = total?.count && total.count > 0 
      ? ((converted?.count || 0) / total.count * 100).toFixed(1)
      : '0.0';

    // This month bookings
    const thisMonth = await queryOne<{ count: number }>(`
      SELECT COUNT(*) as count 
      FROM demo_bookings 
      WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
    `);

    return NextResponse.json({
      total: parseInt(total?.count?.toString() || '0'),
      byStatus: byStatus.reduce((acc: any, item) => {
        acc[item.status] = parseInt(item.count.toString());
        return acc;
      }, {}),
      byLeadSource: byLeadSource.reduce((acc: any, item) => {
        acc[item.lead_source] = parseInt(item.count.toString());
        return acc;
      }, {}),
      converted: parseInt(converted?.count?.toString() || '0'),
      conversionRate: parseFloat(conversionRate),
      thisMonth: parseInt(thisMonth?.count?.toString() || '0')
    });
  } catch (error: any) {
    console.error('Error fetching booking stats:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

