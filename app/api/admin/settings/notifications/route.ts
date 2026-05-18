import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import {
  getPlatformNotificationSettings,
  updatePlatformNotificationSettings,
} from '@/lib/platform-email';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;

  try {
    const settings = await getPlatformNotificationSettings();
    return NextResponse.json({ settings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const settings = await updatePlatformNotificationSettings({
      notify_new_signup: body.notify_new_signup,
      notify_subscription_changes: body.notify_subscription_changes,
      notify_payment_failures: body.notify_payment_failures,
      platform_notify_email: body.platform_notify_email ?? null,
    });
    return NextResponse.json({ settings });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
