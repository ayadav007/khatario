import { NextResponse } from 'next/server';
import { ownerRoute } from '@/lib/hr/staff-app/owner-route';
import { createSite, listSites, parseSiteInput, wifiSuggestions } from '@/lib/hr/staff-app/sites';

export const dynamic = 'force-dynamic';

/** GET /api/employees/attendance/sites — office sites, each with Wi-Fi seen at recent check-ins. */
export const GET = ownerRoute('sites list', 'settings', 'read', async ({ businessId }) => {
  const sites = await listSites(businessId);
  const withSuggestions = await Promise.all(
    sites.map(async (s) => ({ ...s, wifi_suggestions: await wifiSuggestions(businessId, s.id) })),
  );
  return NextResponse.json({ sites: withSuggestions });
});

/** POST /api/employees/attendance/sites — { name, lat, lng, radius_m, require_wifi, wifi: [{ bssid, ssid }] } */
export const POST = ownerRoute('sites create', 'settings', 'update', async ({ request, businessId, userId }) => {
  const input = parseSiteInput(await request.json().catch(() => null));
  const site = await createSite(businessId, userId, input);
  return NextResponse.json({ site }, { status: 201 });
});
