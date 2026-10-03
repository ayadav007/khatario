import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import {
  adminSetStatus,
  assignLead,
  leadDetail,
  sendLeadTemplate,
  sendManualMessage,
  updateLeadNotes,
} from '@/lib/sales-funnel/admin';
import { resumeBot } from '@/lib/sales-funnel/engine';
import { getLeadById, type PipelineStatus } from '@/lib/sales-funnel/leads';

export const dynamic = 'force-dynamic';

function fail(err: unknown) {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  const detail = await leadDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  return NextResponse.json(detail);
}

/** Update assignment, stage or notes. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  const lead = await getLeadById(params.id);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if ('assigned_to' in b) await assignLead(lead, b.assigned_to ? String(b.assigned_to) : null, auth.admin.id);
    if (typeof b.pipeline_status === 'string') await adminSetStatus(lead, b.pipeline_status as PipelineStatus, auth.admin.id);
    if (typeof b.notes === 'string') await updateLeadNotes(lead, b.notes);
    await logAdminAction(auth.admin.id, 'sales_lead_update', 'assistant_lead', lead.id, {
      assigned_to: b.assigned_to,
      pipeline_status: b.pipeline_status,
      notes: typeof b.notes === 'string' ? 'updated' : undefined,
    });
    return NextResponse.json(await leadDetail(lead.id));
  } catch (err) {
    return fail(err);
  }
}

/** action: message (typed text), template (approved funnel template) or resume (hand back to the bot). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  const lead = await getLeadById(params.id);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  const b = (await request.json().catch(() => ({}))) as { action?: string; text?: string; event_key?: string; step_id?: string | null; send?: boolean };
  try {
    switch (b.action) {
      case 'message':
        await sendManualMessage(lead, String(b.text || ''), auth.admin.id);
        break;
      case 'template':
        await sendLeadTemplate(lead, String(b.event_key || ''), auth.admin.id);
        break;
      case 'resume':
        await resumeBot(lead.id, b.step_id || null, { send: Boolean(b.send) });
        break;
      default:
        return fail('Unknown action');
    }
    await logAdminAction(auth.admin.id, `sales_lead_${b.action}`, 'assistant_lead', lead.id, {
      event_key: b.event_key,
      step_id: b.step_id,
    });
    return NextResponse.json(await leadDetail(lead.id));
  } catch (err) {
    return fail(err);
  }
}
