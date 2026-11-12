import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  fetchRosterWeek,
  upsertRosterEntries,
  fillRosterFromDefaults,
  getShiftRosterSettings,
  saveShiftRosterSettings,
  normalizeWeekStart,
} from '@/lib/hr/shift-overtime/shift-roster';
import { ownsEmployeesAndShifts } from '@/lib/hr/shift-overtime/shift-assignment';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'attendance', 'read', { businessId });

    const { searchParams } = new URL(request.url);
    const weekStart = normalizeWeekStart(
      searchParams.get('week_start') ?? new Date().toISOString().slice(0, 10),
    );
    const department = searchParams.get('department') ?? undefined;
    const branchId = searchParams.get('branch_id') ?? undefined;

    const roster = await fetchRosterWeek({
      businessId,
      weekStart,
      department,
      branchId,
    });
    const settings = await getShiftRosterSettings(businessId);

    return NextResponse.json({ ...roster, settings });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Failed to load roster';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'attendance', 'update', { businessId });

    const body = await request.json();

    if (body.settings) {
      const settings = await saveShiftRosterSettings(businessId, body.settings);
      return NextResponse.json({ settings });
    }

    if (body.action === 'fill_defaults') {
      const weekStart = normalizeWeekStart(body.week_start);
      const count = await fillRosterFromDefaults(businessId, weekStart, userId, {
        department: body.department,
        branchId: body.branch_id,
      });
      return NextResponse.json({ filled: count });
    }

    const entries = Array.isArray(body.entries) ? body.entries : [];
    // Every employee and shift must be this business's own: refuse before anything is written.
    const owned = await ownsEmployeesAndShifts(
      businessId,
      entries.map((e: { employee_id?: unknown }) => e?.employee_id),
      entries.map((e: { shift_id?: unknown }) => e?.shift_id).filter((id: unknown) => id != null && id !== ''),
    );
    if (!owned) return NextResponse.json({ error: 'Employee or shift not found' }, { status: 404 });
    const saved = await upsertRosterEntries(businessId, entries, userId);
    return NextResponse.json({ saved });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Failed to save roster';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
