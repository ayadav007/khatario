import { NextResponse } from 'next/server';
import { ownerRoute } from '@/lib/hr/staff-app/owner-route';
import { deactivateSite, parseSiteInput, updateSite } from '@/lib/hr/staff-app/sites';

export const dynamic = 'force-dynamic';

type Params = { siteId: string };

export const PATCH = ownerRoute<Params>('sites update', 'settings', 'update', async ({ request, businessId, params }) => {
  const input = parseSiteInput(await request.json().catch(() => null));
  const site = await updateSite(businessId, params.siteId, input);
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  return NextResponse.json({ site });
});

export const DELETE = ownerRoute<Params>('sites delete', 'settings', 'update', async ({ businessId, params }) => {
  const removed = await deactivateSite(businessId, params.siteId);
  if (!removed) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  return NextResponse.json({ success: true });
});
