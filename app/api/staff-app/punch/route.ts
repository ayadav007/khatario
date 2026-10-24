import { NextResponse } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';
import { staffRoute } from '@/lib/hr/staff-app/route';
import { handleStaffPunch, parsePunchBody } from '@/lib/hr/staff-app/punch';

export const dynamic = 'force-dynamic';

/**
 * POST /api/staff-app/punch — signed. Body: { nonce, action, samples, wifi, signals, client_time_ms }.
 * Always answers 200 with a decision once the evidence was scored; the reasons say why.
 */
export const POST = staffRoute('punch', async ({ request, device, body }) => {
  const punch = parsePunchBody(body);
  const outcome = await handleStaffPunch(device, punch, getClientIp(request));
  return NextResponse.json({ ...outcome, server_time: Date.now() });
});
