import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/accounts/close-year — retired. It overwrote account opening balances instead of
 * posting a closing voucher; use POST /api/financial-years/[id]/close.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'This endpoint has been retired. Close the year from Settings → Financial years (POST /api/financial-years/{id}/close).',
      code: 'ENDPOINT_RETIRED',
    },
    { status: 410 }
  );
}
