import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    // Get total count
    const totalResult = await query<{ count: number }>(
      'SELECT COUNT(*) as count FROM hsn_sac_master'
    );
    const total = parseInt(String(totalResult.rows[0]?.count || '0'));

    // Get HSN codes count (goods)
    const hsnResult = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM hsn_sac_master WHERE is_service = false"
    );
    const hsnCount = parseInt(String(hsnResult.rows[0]?.count || '0'));

    // Get SAC codes count (services)
    const sacResult = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM hsn_sac_master WHERE is_service = true"
    );
    const sacCount = parseInt(String(sacResult.rows[0]?.count || '0'));

    return NextResponse.json({
      total,
      hsn: hsnCount,
      sac: sacCount,
    });
  } catch (error: any) {
    console.error('HSN/SAC stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    );
  }
}

