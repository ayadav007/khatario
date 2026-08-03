import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  updateHolidayInList,
  deleteHolidayFromList,
} from '@/lib/hr/shift-overtime/holiday-lists';

export const dynamic = 'force-dynamic';

function duplicateHolidayMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const msg = error.message.toLowerCase();
  if (msg.includes('unique') || msg.includes('duplicate')) {
    return 'A holiday already exists on this date for your company';
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const holiday = await updateHolidayInList(businessId, params.id, {
      holiday_date: body.holiday_date,
      holiday_name: body.holiday_name,
      description: body.description,
      is_recurring: body.is_recurring,
    });

    if (!holiday) {
      return NextResponse.json({ error: 'Holiday not found' }, { status: 404 });
    }

    return NextResponse.json({ holiday });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const dup = duplicateHolidayMessage(error);
    if (dup) return NextResponse.json({ error: dup }, { status: 409 });
    const message = error instanceof Error ? error.message : 'Failed to update holiday';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'update', { businessId });

    const deleted = await deleteHolidayFromList(businessId, params.id);
    if (!deleted) {
      return NextResponse.json({ error: 'Holiday not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to delete holiday' }, { status: 500 });
  }
}
