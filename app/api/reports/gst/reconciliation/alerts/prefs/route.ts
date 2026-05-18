import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { resolveBranchId } from '@/lib/branch-helpers';
import {
  getGstAlertNotificationPrefsEffective,
  saveGstAlertNotificationPrefs,
  type GstAlertRecipient,
} from '@/lib/gst/gstr13b-notifications';

const SEVERITIES = new Set(['high', 'medium', 'low']);

function parseRecipientsBody(body: unknown): GstAlertRecipient[] {
  if (!Array.isArray(body)) return [];
  const out: GstAlertRecipient[] = [];
  for (const r of body) {
    if (!r || typeof r !== 'object') continue;
    const type = (r as GstAlertRecipient).type;
    const value = (r as GstAlertRecipient).value;
    if (type !== 'email' && type !== 'whatsapp') continue;
    if (typeof value !== 'string' || !value.trim()) continue;
    out.push({ type, value: value.trim() });
  }
  return out;
}

/**
 * GET /api/reports/gst/reconciliation/alerts/prefs?branch_id=
 * Returns effective prefs (branch override → business → defaults).
 */
export async function GET(request: NextRequest) {
  try {
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    try {
      await assertReportAccess(business_id, 'gst');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { searchParams } = new URL(request.url);
    const branchIdParam = searchParams.get('branch_id');

    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam || undefined,
        businessId: business_id,
      });
    } catch (error: any) {
      if (
        error.code === 'BRANCH_NOT_FOUND' ||
        error.code === 'BRANCH_BUSINESS_MISMATCH' ||
        error.code === 'BRANCH_INACTIVE'
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      throw error;
    }

    try {
      await authorize(userId, 'report.gst', 'read', {
        businessId: business_id,
        branchId: finalBranchId,
        resource: { business_id, branch_id: finalBranchId },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const prefs = await getGstAlertNotificationPrefsEffective(business_id, finalBranchId);
    return NextResponse.json({ prefs });
  } catch (error: any) {
    console.error('GST alert prefs GET error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to load notification preferences' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reports/gst/reconciliation/alerts/prefs
 * Body: { apply_to: 'business' | 'branch', ...prefs }
 */
export async function POST(request: NextRequest) {
  try {
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    try {
      await assertReportAccess(business_id, 'gst');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const body = (await request.json()) as Record<string, unknown>;
    const applyTo = body.apply_to === 'business' ? 'business' : 'branch';
    const { searchParams } = new URL(request.url);
    const branchIdParam =
      typeof body.branch_id === 'string' ? body.branch_id : searchParams.get('branch_id');

    let resolvedBranchId: string;
    try {
      resolvedBranchId = await resolveBranchId({
        branchId: branchIdParam || undefined,
        businessId: business_id,
      });
    } catch (error: any) {
      if (
        error.code === 'BRANCH_NOT_FOUND' ||
        error.code === 'BRANCH_BUSINESS_MISMATCH' ||
        error.code === 'BRANCH_INACTIVE'
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      throw error;
    }

    try {
      await authorize(userId, 'report.gst', 'read', {
        businessId: business_id,
        branchId: resolvedBranchId,
        resource: { business_id, branch_id: resolvedBranchId },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const notifyOnRaw = body.notify_on;
    const notify_on = Array.isArray(notifyOnRaw)
      ? (notifyOnRaw as string[]).filter((s) => typeof s === 'string' && SEVERITIES.has(s))
      : ['high', 'medium'];
    if (notify_on.length === 0) {
      return NextResponse.json({ error: 'notify_on must include at least one severity' }, { status: 400 });
    }

    const storeBranchId = applyTo === 'business' ? null : resolvedBranchId;

    const row = await saveGstAlertNotificationPrefs({
      businessId: business_id,
      branchId: storeBranchId,
      email_enabled: Boolean(body.email_enabled),
      whatsapp_enabled: Boolean(body.whatsapp_enabled),
      notify_on,
      include_low: Boolean(body.include_low),
      quiet_hours_start:
        typeof body.quiet_hours_start === 'string' && body.quiet_hours_start.trim()
          ? body.quiet_hours_start.trim()
          : null,
      quiet_hours_end:
        typeof body.quiet_hours_end === 'string' && body.quiet_hours_end.trim()
          ? body.quiet_hours_end.trim()
          : null,
      cooldown_minutes:
        typeof body.cooldown_minutes === 'number' && Number.isFinite(body.cooldown_minutes)
          ? Math.floor(body.cooldown_minutes)
          : 120,
      recipients: parseRecipientsBody(body.recipients),
    });

    return NextResponse.json({ ok: true, prefs: row, stored_scope: applyTo });
  } catch (error: any) {
    console.error('GST alert prefs POST error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to save notification preferences' },
      { status: 500 }
    );
  }
}
