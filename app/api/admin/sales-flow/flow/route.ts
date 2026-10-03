import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import {
  FLOW_ACTIONS,
  FOLLOWUP_ANCHORS,
  FOLLOWUP_CONDITIONS,
  LEAD_FIELDS,
  validateFlow,
} from '@/lib/sales-funnel/definition';
import { DEFAULT_FLOW } from '@/lib/sales-funnel/default-flow';
import { previewStep } from '@/lib/sales-funnel/engine';
import { listMedia } from '@/lib/sales-funnel/media';
import { FUNNEL_EVENT_KEYS } from '@/lib/sales-funnel/templates';
import {
  discardDraft,
  getDraft,
  getPublishedFlow,
  listVersions,
  publishDraft,
  restoreVersion,
  saveDraft,
} from '@/lib/sales-funnel/store';

export const dynamic = 'force-dynamic';

function errorResponse(err: unknown, status = 400) {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  try {
    const published = await getPublishedFlow();
    const [draft, versions, media] = await Promise.all([getDraft(), listVersions(), listMedia()]);
    const check = validateFlow(draft.flow);
    return NextResponse.json({
      draft: { version: draft.version, flow: draft.flow, updated_at: draft.updated_at, errors: check.ok ? [] : check.errors },
      published: { version: published.version },
      versions,
      media,
      options: {
        actions: FLOW_ACTIONS,
        leadFields: LEAD_FIELDS,
        anchors: FOLLOWUP_ANCHORS,
        conditions: FOLLOWUP_CONDITIONS,
        templateEventKeys: FUNNEL_EVENT_KEYS,
      },
    });
  } catch (err) {
    console.error('[admin/sales-flow/flow] GET failed:', err);
    return errorResponse(err, 500);
  }
}

/** Save the draft (does not affect live conversations until published). */
export async function PUT(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('flow' in body)) return errorResponse('Missing flow');
  const result = await saveDraft((body as { flow: unknown }).flow, auth.admin.id);
  if (!result.ok) return NextResponse.json({ error: 'The flow has problems', errors: result.errors }, { status: 422 });
  return NextResponse.json({ ok: true, version: result.version });
}

type FlowAction =
  | { action: 'publish'; note?: string }
  | { action: 'discard' }
  | { action: 'restore'; version: number }
  | { action: 'reset_default' }
  | { action: 'test'; stepId: string; phone: string };

export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as FlowAction | null;
  if (!body?.action) return errorResponse('Missing action');
  const adminId = auth.admin.id;
  try {
    switch (body.action) {
      case 'publish': {
        const res = await publishDraft(adminId, body.note ?? null);
        if (!res.ok) return NextResponse.json({ error: 'The draft has problems', errors: res.errors }, { status: 422 });
        await logAdminAction(adminId, 'sales_flow_publish', 'sales_flow', String(res.version), { note: body.note ?? null });
        return NextResponse.json({ ok: true, version: res.version });
      }
      case 'discard':
        await discardDraft();
        await logAdminAction(adminId, 'sales_flow_discard_draft', 'sales_flow');
        return NextResponse.json({ ok: true });
      case 'restore': {
        const res = await restoreVersion(Number(body.version), adminId);
        if (!res.ok) return NextResponse.json({ error: res.errors.join('; '), errors: res.errors }, { status: 422 });
        await logAdminAction(adminId, 'sales_flow_restore', 'sales_flow', String(body.version));
        return NextResponse.json({ ok: true, version: res.version });
      }
      case 'reset_default': {
        const res = await saveDraft(DEFAULT_FLOW, adminId);
        if (!res.ok) return NextResponse.json({ error: res.errors.join('; ') }, { status: 422 });
        await logAdminAction(adminId, 'sales_flow_reset_default', 'sales_flow');
        return NextResponse.json({ ok: true, version: res.version });
      }
      case 'test': {
        const phone = String(body.phone || '').replace(/\D/g, '');
        const to = phone.length === 10 ? `91${phone}` : phone;
        if (to.length < 11 || to.length > 15) return errorResponse('Enter your WhatsApp number with country code');
        const draft = await getDraft();
        const sent = await previewStep(draft.flow, String(body.stepId || ''), to);
        await logAdminAction(adminId, 'sales_flow_test_send', 'sales_flow', String(body.stepId));
        return NextResponse.json({ ok: true, sent });
      }
      default:
        return errorResponse('Unknown action');
    }
  } catch (err) {
    console.error('[admin/sales-flow/flow] action failed:', err);
    return errorResponse(err);
  }
}
