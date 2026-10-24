import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { staffRoute } from '@/lib/hr/staff-app/route';
import { CHALLENGE_TTL_MS } from '@/lib/hr/staff-app/punch';
import { newLivenessChallenge } from '@/lib/hr/staff-app/face/liveness';
import { hasActiveFace } from '@/lib/hr/staff-app/face/store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/staff-app/challenge — signed. A single-use code the next punch must carry, and for an
 * employee with an approved face, the liveness actions to do (in this order) with it.
 */
export const POST = staffRoute('challenge', async ({ device }) => {
  const rl = checkRateLimit(`staff-challenge:${device.device_id}`, 30, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many tries. Wait a little and try again.', code: 'RATE_LIMITED' }, { status: 429 });
  }
  const nonce = randomBytes(24).toString('base64url');
  const face = (await hasActiveFace(device.employee_id)) ? newLivenessChallenge() : null;
  await query(
    `INSERT INTO staff_app_challenges (device_id, nonce, expires_at, liveness)
     VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 || ' milliseconds')::interval, $4)`,
    [device.device_id, nonce, String(CHALLENGE_TTL_MS), face ? JSON.stringify(face) : null],
  );
  return NextResponse.json({
    nonce,
    expires_in_ms: CHALLENGE_TTL_MS,
    server_time: Date.now(),
    // How the phone should sample GPS before it punches.
    sampling: { count: 5, interval_ms: 1500 },
    face,
  });
});
