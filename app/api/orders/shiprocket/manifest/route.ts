import { NextRequest, NextResponse } from 'next/server';
import { resolveHubAuth } from '@/lib/fulfilment/hub-scope';
import {
  generateShiprocketManifest,
  isShiprocketConfigured,
  pendingManifestCount,
} from '@/lib/fulfilment/shiprocket-booking';

export const dynamic = 'force-dynamic';

/** GET: whether Shiprocket is connected and how many booked parcels still need a manifest. */
export async function GET(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'read');
  if (!auth.ok) return auth.response;
  const configured = await isShiprocketConfigured(auth.scope.businessId);
  const pending = configured ? await pendingManifestCount(auth.scope.businessId, auth.scope.branchIds) : 0;
  return NextResponse.json({ configured, pending });
}

/** POST: one manifest for every booked parcel not yet on one (or today's last one again). */
export async function POST(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'update');
  if (!auth.ok) return auth.response;
  const result = await generateShiprocketManifest(auth.scope.businessId, auth.scope.branchIds);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
