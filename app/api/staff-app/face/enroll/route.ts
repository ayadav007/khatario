import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { staffRoute } from '@/lib/hr/staff-app/route';
import { captureEnrollment } from '@/lib/hr/staff-app/face/enrollment';

export const dynamic = 'force-dynamic';

/**
 * POST /api/staff-app/face/enroll — signed. Body: { enrollment_id, consent: { version, accepted },
 * photos: [{ label: 'front' | 'left' | 'right' | 'up' | 'down', jpeg: base64 }] }.
 * Only works while a manager has an enrollment open for this employee; the manager approves after.
 */
export const POST = staffRoute('face enroll', async ({ device, body }) => {
  const rl = checkRateLimit(`staff-face-enroll:${device.device_id}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many tries. Wait a little and try again.', code: 'RATE_LIMITED' }, { status: 429 });
  }
  const result = await captureEnrollment(device, body);
  return NextResponse.json({ ...result, status: 'captured', server_time: Date.now() });
});
