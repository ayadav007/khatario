import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { requirePortalSession } from '@/lib/employee-portal/portal-route-guard';
import {
  fetchActiveAnnouncements,
  fetchPublishedArticles,
  fetchActivePollsForEmployee,
  castPollVote,
} from '@/lib/hr/engagement';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    const emp = await queryOne<{ department: string | null }>(
      `SELECT department FROM employees WHERE id = $1`,
      [auth.session.employeeId],
    );

    const [announcements, articles, polls] = await Promise.all([
      fetchActiveAnnouncements(auth.session.businessId, {
        employeeId: auth.session.employeeId,
        department: emp?.department ?? null,
      }),
      fetchPublishedArticles(auth.session.businessId),
      fetchActivePollsForEmployee(
        auth.session.businessId,
        auth.session.employeeId,
        emp?.department ?? null,
      ),
    ]);

    return NextResponse.json({ announcements, articles, polls });
  } catch (error) {
    console.error('[portal/engagement GET]', error);
    return NextResponse.json({ error: 'Failed to load engagement feed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    if (body.action === 'vote') {
      const pollId = String(body.poll_id ?? '');
      const optionIds = Array.isArray(body.option_ids)
        ? body.option_ids.map(String)
        : body.option_id
          ? [String(body.option_id)]
          : [];
      if (!pollId || !optionIds.length) {
        return NextResponse.json({ error: 'poll_id and option required' }, { status: 400 });
      }
      await castPollVote(pollId, auth.session.employeeId, optionIds);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
