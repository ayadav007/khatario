import { NextRequest, NextResponse } from 'next/server';
import { fetchEmployeeHolidays } from '@/lib/employee-portal/portal-dashboard';
import { requirePortalSession } from '@/lib/employee-portal/portal-route-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    const rawYear = request.nextUrl.searchParams.get('year');
    const year = rawYear ? Number(rawYear) : new Date().getFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }

    const { businessId, employeeId } = auth.session;
    const holidays = await fetchEmployeeHolidays(businessId, employeeId, year);
    return NextResponse.json({
      year,
      holidays: holidays.map((holiday) => ({
        id: holiday.id,
        holiday_date: holiday.holiday_date.slice(0, 10),
        holiday_name: holiday.holiday_name,
        description: holiday.description,
      })),
    });
  } catch (error) {
    console.error('[portal/holidays GET]', error);
    return NextResponse.json({ error: 'Failed to load holidays' }, { status: 500 });
  }
}
