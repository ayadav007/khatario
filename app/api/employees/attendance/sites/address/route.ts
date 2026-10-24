import { NextResponse } from 'next/server';
import { ownerRoute } from '@/lib/hr/staff-app/owner-route';
import { isValidCoordinate, reverseGeocode } from '@/lib/hr/staff-app/reverse-geocode';

export const dynamic = 'force-dynamic';

/** GET /api/employees/attendance/sites/address?lat=&lng= — street address from OpenStreetMap. */
export const GET = ownerRoute('site address', 'settings', 'read', async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lng = Number(searchParams.get('lng'));
  if (!isValidCoordinate(lat, lng)) {
    return NextResponse.json({ error: 'Enter a valid latitude and longitude.' }, { status: 400 });
  }
  try {
    return NextResponse.json({ address: await reverseGeocode(lat, lng) });
  } catch {
    return NextResponse.json({ error: 'Could not look up the address right now.' }, { status: 502 });
  }
});
