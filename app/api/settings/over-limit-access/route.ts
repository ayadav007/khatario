import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { requireStrictSession } from '@/lib/auth-helpers';
import { isPrimaryAdminForBusiness } from '@/lib/enforce-access';
import {
  OverLimitChoiceError,
  computeBranchAccess,
  computeSeatAccess,
  saveOverLimitChoice,
} from '@/lib/subscription/over-limit-access';

export const dynamic = 'force-dynamic';

const OWNER_ONLY = { error: 'Only the business owner can choose who keeps access.', code: 'NOT_OWNER' };

/**
 * GET /api/settings/over-limit-access
 * Owner only. Who keeps a seat and which branches stay writable under the current plan, and who does not.
 * Business and user come from the session, never from the request.
 */
export async function GET(request: NextRequest) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;
  const { userId, businessId } = session;
  if (!(await isPrimaryAdminForBusiness(userId, businessId))) return NextResponse.json(OWNER_ONLY, { status: 403 });

  try {
    const [seats, branches] = await Promise.all([computeSeatAccess(businessId), computeBranchAccess(businessId)]);

    const people = await queryRows<{ id: string; name: string | null; phone: string | null; role_name: string | null }>(
      `SELECT u.id, u.name, u.phone, ur.role_name
         FROM users u LEFT JOIN user_roles ur ON ur.id = u.role_id
        WHERE u.business_id = $1 AND u.id = ANY($2::uuid[])`,
      [businessId, seats.holders.map((h) => h.id)],
    );
    const personById = new Map(people.map((p) => [p.id, p]));

    return NextResponse.json({
      seats: {
        allowed: seats.allowed,
        used: seats.holders.length,
        over_limit: seats.pausedIds.size > 0,
        users: seats.holders.map((h) => ({
          id: h.id,
          name: personById.get(h.id)?.name ?? 'User',
          phone: personById.get(h.id)?.phone ?? null,
          role_name: personById.get(h.id)?.role_name ?? null,
          is_owner: h.isPrimaryAdmin,
          chosen: h.keep,
          paused: seats.pausedIds.has(h.id),
        })),
      },
      branches: {
        allowed: branches.allowed,
        used: branches.branches.length,
        over_limit: branches.readOnlyIds.size > 0,
        branches: branches.branches.map((b) => ({
          id: b.id,
          name: b.name,
          is_default: b.isDefault,
          chosen: b.keep,
          read_only: branches.readOnlyIds.has(b.id),
        })),
      },
    });
  } catch (error) {
    console.error('Error reading over-limit access:', error);
    return NextResponse.json({ error: 'Could not load this just now. Please try again.' }, { status: 500 });
  }
}

/**
 * PUT /api/settings/over-limit-access  { keep_user_ids?: string[], keep_branch_ids?: string[] }
 * Owner only. Saves who keeps a seat / which branches stay writable. The count is validated against the plan
 * inside one locked transaction; nothing is deleted and everyone else keeps their data, just paused / read-only.
 */
export async function PUT(request: NextRequest) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;
  const { userId, businessId } = session;

  let body: { keep_user_ids?: unknown; keep_branch_ids?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Send the choice as JSON.' }, { status: 400 });
  }
  const asIds = (v: unknown): string[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new OverLimitChoiceError('NOT_FOUND', 'The list of chosen ids is not valid.');
    return v as string[];
  };

  try {
    const keepUserIds = asIds(body.keep_user_ids);
    const keepBranchIds = asIds(body.keep_branch_ids);
    if (!keepUserIds && !keepBranchIds) {
      return NextResponse.json({ error: 'Choose at least one user or branch.' }, { status: 400 });
    }
    await saveOverLimitChoice(businessId, userId, { keepUserIds, keepBranchIds });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof OverLimitChoiceError) {
      const status = error.code === 'NOT_OWNER' ? 403 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    // An id that is not a UUID is a bad request, not a server error.
    if (error instanceof Error && /invalid input syntax for type uuid/i.test(error.message)) {
      return NextResponse.json({ error: 'The list of chosen ids is not valid.', code: 'NOT_FOUND' }, { status: 400 });
    }
    console.error('Error saving over-limit access choice:', error);
    return NextResponse.json({ error: 'Could not save this just now. Nothing was changed. Please try again.' }, { status: 500 });
  }
}
