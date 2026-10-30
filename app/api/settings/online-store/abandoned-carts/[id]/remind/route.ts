import { NextRequest, NextResponse } from 'next/server';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { sendCartReminder } from '@/lib/store/abandoned-carts';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/settings/online-store/abandoned-carts/[id]/remind: send one reminder now (once per 24 h). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await requireTenantPermission(
    request,
    new URL(request.url).searchParams.get('business_id'),
    'settings',
    'update',
  );
  if (!tenant.ok) return tenant.response;
  const planDenied = await denyIfFeatureMissing(tenant.businessId, 'advanced_online_store');
  if (planDenied) return planDenied;

  const id = params.id;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Cart not found' }, { status: 404 });

  try {
    const res = await sendCartReminder({ id, businessId: tenant.businessId }, 'manual');
    if (res.sent) return NextResponse.json({ sent: true, channel: res.channel });
    switch (res.error) {
      case 'not_found':
      case 'empty':
        return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
      case 'too_soon':
        return NextResponse.json({ error: 'Reminder already sent in the last 24 hours' }, { status: 409 });
      case 'store_disabled':
        return NextResponse.json({ error: 'Turn on your online store to send reminders.' }, { status: 400 });
      default:
        return NextResponse.json({ error: 'Could not send the reminder. Try again later.' }, { status: 502 });
    }
  } catch (error) {
    console.error('abandoned-carts remind:', error);
    return NextResponse.json({ error: 'Could not send the reminder. Try again later.' }, { status: 500 });
  }
}
