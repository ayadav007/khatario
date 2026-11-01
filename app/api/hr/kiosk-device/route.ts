import { NextRequest, NextResponse } from 'next/server';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { getHrPortalSettings } from '@/lib/hr/hr-portal-settings';
import {
  createKioskDeviceToken,
  KIOSK_DEVICE_COOKIE,
  kioskDeviceCookieOptions,
} from '@/lib/employee-portal/kiosk-device';

export const dynamic = 'force-dynamic';

/**
 * POST /api/hr/kiosk-device
 * Register this browser as the business's attendance kiosk. Needs a signed-in user who may
 * change settings; the kiosk page calls it while a manager is signed in on the shared tablet.
 * Revoke all devices with PATCH /api/settings/hr-portal { revoke_kiosk_devices: true }.
 */
export async function POST(request: NextRequest) {
  const access = await requireTenantPermission(request, null, 'settings', 'update');
  if (!access.ok) return access.response;

  const settings = await getHrPortalSettings(access.businessId);
  if (!settings.kiosk_enabled) {
    return NextResponse.json({ error: 'Turn on the attendance kiosk in HR settings first' }, { status: 409 });
  }

  const response = NextResponse.json({ registered: true });
  response.cookies.set(
    KIOSK_DEVICE_COOKIE,
    createKioskDeviceToken(access.businessId, settings.kiosk_device_generation),
    kioskDeviceCookieOptions()
  );
  return response;
}
