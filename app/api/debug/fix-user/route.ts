import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/debug/fix-user
 * Disabled: it made any user a primary admin and granted the Primary Admin role full permissions
 * without authorization. Repair primary-admin state through an operator script instead.
 */
export async function POST() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
