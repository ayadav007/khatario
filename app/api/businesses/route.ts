import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import {
  assertUserSessionVersionMatches,
  getSessionVersionFromRequest,
  requireTenantBusinessId,
} from '@/lib/auth-helpers';
import { clearSessionCookie, setSessionCookies, signAccessToken, signRefreshToken } from '@/lib/jwt';
import { checkRateLimit } from '@/lib/rate-limit';
import { normalizeProductLine } from '@/lib/product-lines';
import { clearSubscriptionCache } from '@/lib/subscription';
import { parseAddBusinessInput } from '@/lib/businesses/create-business-input';
import { provisionBusiness } from '@/lib/businesses/provision-business';
import { attachUserAsOwner, grantOwnerBranchAccess } from '@/lib/businesses/owner-membership';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

export const dynamic = 'force-dynamic';

const USER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionUserId(request: NextRequest): string | null {
  const id = request.headers.get('x-authenticated-user-id')?.trim() ?? '';
  return USER_UUID_RE.test(id) ? id : null;
}

/**
 * POST /api/businesses
 * Creates another company for the logged-in owner and switches the session to it.
 * The acting user comes from the verified session, never from the body.
 */
export async function POST(request: NextRequest) {
  const userId = sessionUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const rl = checkRateLimit(`add-business:${userId}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many new businesses. Please try again later.', retryAfterMs: rl.retryAfterMs },
      { status: 429 },
    );
  }

  const svCheck = await assertUserSessionVersionMatches(request, userId);
  if (!svCheck.ok) {
    const res = NextResponse.json({ error: 'Session revoked', code: 'SESSION_REVOKED' }, { status: 401 });
    clearSessionCookie(res);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = parseAddBusinessInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const owner = await queryOne<{ id: string; business_id: string | null }>(
    `SELECT u.id, u.business_id
     FROM users u
     WHERE u.id = $1 AND COALESCE(u.is_active, true) = true`,
    [userId],
  );
  if (!owner?.business_id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Everything is judged on the business this session works in, not on the stored pointer users.business_id
  // (which moves when the owner switches business in another session): the plan, the ownership and the
  // product line of the new business.
  const tenant = requireTenantBusinessId(request);
  if (!tenant.ok) {
    return tenant.response;
  }
  const sessionBusiness = await queryOne<{ product_line: string | null }>(
    `SELECT b.product_line
       FROM user_businesses ub
       JOIN businesses b ON b.id = ub.business_id
      WHERE ub.user_id = $1 AND ub.business_id = $2 AND ub.role = 'owner'`,
    [userId, tenant.businessId],
  );
  if (!sessionBusiness) {
    return NextResponse.json(
      { error: 'Only the business owner can add another business' },
      { status: 403 },
    );
  }

  try {
    await assertFeatureAccess(tenant.businessId, 'multi_business');
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) {
      return error.toNextResponse();
    }
    console.error('POST /api/businesses feature check:', error);
    return NextResponse.json({ error: 'Could not create the business' }, { status: 500 });
  }

  const sessionVersion = getSessionVersionFromRequest(request);
  if (sessionVersion === null) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const pool = getPool();
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    await attachUserAsOwner(client, userId, tenant.businessId);

    // Every business added through this route starts on Free: the owner already has a business, so
    // provisionBusiness does not grant another trial (one trial per owner).
    const provisioned = await provisionBusiness(client, {
      ...parsed.value,
      ownerUserId: userId,
      productLine: normalizeProductLine(sessionBusiness.product_line),
    });
    await attachUserAsOwner(client, userId, provisioned.businessId);
    await grantOwnerBranchAccess(client, userId, provisioned.defaultBranchId);

    await client.query(
      `UPDATE users
       SET business_id = $1,
           role_id = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [provisioned.businessId, provisioned.primaryAdminRoleId, userId],
    );

    await client.query('COMMIT');
    committed = true;
    clearSubscriptionCache(provisioned.businessId);

    const tokenPayload = { userId, businessId: provisioned.businessId, sessionVersion };
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(tokenPayload),
      signRefreshToken(tokenPayload),
    ]);
    const response = NextResponse.json(
      { success: true, businessId: provisioned.businessId },
      { status: 201 },
    );
    setSessionCookies(response, accessToken, refreshToken);
    return response;
  } catch (error) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Add business rollback failed:', rollbackErr);
      }
    }
    console.error('POST /api/businesses:', error);
    return NextResponse.json({ error: 'Could not create the business' }, { status: 500 });
  } finally {
    client.release();
  }
}
