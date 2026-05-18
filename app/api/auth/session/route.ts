import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { getUserBranches, BranchWithDetails } from '@/lib/branch-access';
import { User, Business } from '@/types/database';
import { getUserIdFromRequest, assertUserSessionVersionMatches } from '@/lib/auth-helpers';
import { clearSessionCookie } from '@/lib/jwt';
import { mergePortalTheme } from '@/lib/portal-theme';
import {
  getEffectivePlanId,
  shouldShowTrialBadge,
} from '@/lib/subscription/effective-plan';

/** Invalid JWT session: clear httpOnly cookies so the client cannot keep navigating with a ghost tenant. */
function jsonSessionInvalid(
  status: number,
  body: { error: string; code: string }
): NextResponse {
  const res = NextResponse.json(body, { status });
  clearSessionCookie(res);
  return res;
}

/**
 * GET /api/auth/session
 *
 * Unified session endpoint that returns everything the client needs in a
 * single round-trip: user, business, branches, permissions, and subscription info.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const svCheck = await assertUserSessionVersionMatches(request, userId);
    if (!svCheck.ok) {
      return jsonSessionInvalid(401, {
        error: 'Session revoked',
        code: 'SESSION_REVOKED',
      });
    }

    // --- 1. User + Business (single join query instead of two separate ones) ---
    const row = await queryOne<User & { business_name: string }>(
      `SELECT u.*, b.id as biz_id, b.name as business_name
       FROM users u
       LEFT JOIN businesses b ON b.id = u.business_id
       WHERE u.id = $1`,
      [userId]
    );

    if (!row) {
      return jsonSessionInvalid(401, {
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const { password_hash, business_name, biz_id, ...safeUser } = row as any;

    // Fetch full business object only if needed (keep it lightweight)
    const business = row.business_id
      ? await queryOne<Business>('SELECT * FROM businesses WHERE id = $1', [row.business_id])
      : null;

    // Orphan user: JWT still valid but business row was removed (e.g. manual DELETE FROM businesses).
    // Do not return 200 with business=null — client would break (limits, APIs). Force re-login.
    if (row.business_id && !business) {
      return jsonSessionInvalid(401, {
        error: 'Business no longer exists',
        code: 'BUSINESS_NOT_FOUND',
      });
    }

    const suspendedAt = (business as { platform_suspended_at?: string | null } | null)
      ?.platform_suspended_at;
    if (suspendedAt) {
      return jsonSessionInvalid(403, {
        error: 'This account has been suspended. Please contact Khatario support.',
        code: 'BUSINESS_SUSPENDED',
      });
    }

    // --- 2. Branches (reuse existing helper) ---
    let branches: BranchWithDetails[] = [];
    try {
      branches = await getUserBranches(userId);
    } catch {
      // Non-critical, continue
    }
    const primaryBranch = branches.find(b => b.is_primary) || branches[0] || null;

    // --- 3. Permissions (inline the logic from /api/settings/permissions) ---
    let isPrimaryAdmin = (safeUser as any).is_primary_admin || false;
    const permissions: Record<string, {
      can_view: boolean;
      can_add: boolean;
      can_modify: boolean;
      can_delete: boolean;
      can_share: boolean;
    }> = {};

    if ((safeUser as any).role_id) {
      const role = await queryOne<{ role_key?: string }>(
        'SELECT role_key FROM user_roles WHERE id = $1',
        [(safeUser as any).role_id]
      );
      if (role?.role_key === 'primary_admin') {
        isPrimaryAdmin = true;
      }
    }

    if (isPrimaryAdmin) {
      const allModules = await queryRows<{ module_key: string }>(
        'SELECT module_key FROM permission_modules WHERE is_active = true'
      );
      for (const m of allModules) {
        permissions[m.module_key] = {
          can_view: true, can_add: true, can_modify: true, can_delete: true, can_share: true,
        };
      }
    } else if ((safeUser as any).role_id) {
      const rolePerms = await queryRows<{
        module_key: string;
        can_view: boolean;
        can_add: boolean;
        can_modify: boolean;
        can_delete: boolean;
        can_share: boolean;
      }>(
        `SELECT module_key, can_view, can_add, can_modify, can_delete, can_share
         FROM role_permissions WHERE role_id = $1 ORDER BY module_key`,
        [(safeUser as any).role_id]
      );
      for (const p of rolePerms) {
        permissions[p.module_key] = {
          can_view: p.can_view || false,
          can_add: p.can_add || false,
          can_modify: p.can_modify || false,
          can_delete: p.can_delete || false,
          can_share: p.can_share || false,
        };
      }
    }

    // --- 4. Subscription summary ---
    let subscription: any = null;
    if (row.business_id) {
      const subRow = await queryOne<{
        plan_id: string;
        status: string;
        trial_end_date: string | null;
        end_date: string | null;
        grace_period_end: string | null;
        plan_display_name: string;
        features: unknown;
      }>(
        `SELECT bs.plan_id, bs.status, bs.trial_end_date::text, bs.end_date::text,
                bs.grace_period_end::text, sp.display_name as plan_display_name, sp.features
         FROM business_subscriptions bs
         JOIN subscription_plans sp ON bs.plan_id = sp.id
         WHERE bs.business_id = $1
         ORDER BY
           CASE WHEN bs.status IN ('active', 'trial') THEN 0 ELSE 1 END,
           bs.updated_at DESC NULLS LAST
         LIMIT 1`,
        [row.business_id],
      );

      if (subRow) {
        const effectivePlanId = getEffectivePlanId(subRow);
        let displayName = subRow.plan_display_name;
        if (effectivePlanId !== subRow.plan_id) {
          const eff = await queryOne<{ display_name: string }>(
            `SELECT display_name FROM subscription_plans WHERE id = $1`,
            [effectivePlanId],
          );
          displayName = eff?.display_name || 'Free / Starter';
        }
        subscription = {
          plan_id: effectivePlanId,
          plan_name: effectivePlanId,
          status: subRow.status,
          trial_end_date: subRow.trial_end_date,
          end_date: subRow.end_date,
          grace_period_end: subRow.grace_period_end,
          plan_display_name: displayName,
          features: subRow.features,
          show_trial_badge: shouldShowTrialBadge(subRow),
          stored_plan_id: subRow.plan_id,
        };
      }
    }

    // --- 5. Active branch count (business-wide, for profile save + feature UX) ---
    let activeBranchCount = 0;
    if (row.business_id) {
      const cnt = await queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM branches WHERE business_id = $1 AND is_active = true`,
        [row.business_id]
      );
      activeBranchCount = parseInt(cnt?.n ?? '0', 10) || 0;
    }

    let portalTheme: ReturnType<typeof mergePortalTheme> | null = null;
    if (row.business_id) {
      const bs = await queryOne<{ portal_theme: unknown }>(
        'SELECT portal_theme FROM business_settings WHERE business_id = $1',
        [row.business_id]
      );
      portalTheme = mergePortalTheme(bs?.portal_theme);
    }

    return NextResponse.json({
      user: safeUser,
      business,
      branch: primaryBranch,
      branches,
      permissions,
      isPrimaryAdmin,
      subscription,
      activeBranchCount,
      portalTheme,
    });
  } catch (error: any) {
    console.error('Session endpoint error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
