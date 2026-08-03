import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { limitExceededResponse } from '@/lib/subscription/limit-response';
import {
  listHolidayLists,
  ensureDefaultHolidayList,
  ensureBranchHolidayList,
  listHolidaysForList,
  importHolidayCsv,
  createHolidayInList,
} from '@/lib/hr/shift-overtime/holiday-lists';
import { queryRows } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    await authorize(userId, 'settings', 'read', { businessId });

    const { searchParams } = new URL(request.url);
    const listId = searchParams.get('list_id');
    const year = searchParams.get('year');

    const lists = await listHolidayLists(businessId);
    if (listId) {
      const holidays = await listHolidaysForList(listId, year ? Number(year) : undefined);
      return NextResponse.json({ lists, holidays });
    }

    const branches = await queryRows<{ id: string; name: string }>(
      `SELECT id, name FROM branches WHERE business_id = $1 ORDER BY name`,
      [businessId],
    );
    return NextResponse.json({ lists, branches });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load holiday lists' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    if (body.action === 'import' && body.list_id && body.csv) {
      const result = await importHolidayCsv(businessId, body.list_id, body.csv);
      return NextResponse.json(result);
    }

    if (body.action === 'create' && body.list_id) {
      const holidayLimit = await limitExceededResponse(businessId, 'holidays');
      if (holidayLimit) return holidayLimit;

      try {
        const holiday = await createHolidayInList(businessId, body.list_id, {
          holiday_date: body.holiday_date,
          holiday_name: body.holiday_name,
          description: body.description,
          is_recurring: body.is_recurring,
        });
        return NextResponse.json({ holiday }, { status: 201 });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to create holiday';
        const lower = msg.toLowerCase();
        if (lower.includes('unique') || lower.includes('duplicate')) {
          return NextResponse.json(
            { error: 'A holiday already exists on this date for your company' },
            { status: 409 },
          );
        }
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    if (body.branch_id) {
      const list = await ensureBranchHolidayList(businessId, body.branch_id, body.name);
      return NextResponse.json({ list });
    }

    const list = await ensureDefaultHolidayList(businessId);
    return NextResponse.json({ list });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed' }, { status: 400 });
  }
}
