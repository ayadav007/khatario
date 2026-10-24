import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import { MetaWhatsAppError } from '@/lib/meta-whatsapp';
import { sendApprovedTemplateTest } from '@/lib/platform-whatsapp-send';
import {
  getPlatformWhatsAppTemplate,
  submitPlatformWhatsAppTemplate,
  updatePlatformWhatsAppDraft,
} from '@/lib/platform-whatsapp-templates';
import { FUNNEL_EVENT_KEYS } from '@/lib/sales-funnel/templates';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function fail(err: unknown) {
  if (err instanceof MetaWhatsAppError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
}

async function funnelTemplate(id: string) {
  const t = await getPlatformWhatsAppTemplate(id);
  return t && t.event_key && (FUNNEL_EVENT_KEYS as string[]).includes(t.event_key) ? t : null;
}

/** Edit a draft or rejected funnel template (header media, text, quick replies). */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  if (!(await funnelTemplate(params.id))) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (v === undefined ? undefined : v === null ? null : String(v));
  try {
    const template = await updatePlatformWhatsAppDraft(params.id, {
      category: b.category !== undefined ? String(b.category) : undefined,
      body_text: b.body_text !== undefined ? String(b.body_text) : undefined,
      footer_text: str(b.footer_text),
      header_format: str(b.header_format),
      header_media_key: str(b.header_media_key),
      example_vars: Array.isArray(b.example_vars) ? b.example_vars.map(String) : undefined,
      quick_replies: Array.isArray(b.quick_replies) ? b.quick_replies.map(String) : undefined,
    });
    await logAdminAction(auth.admin.id, 'sales_flow_template_update', 'platform_whatsapp_template', params.id);
    return NextResponse.json({ template });
  } catch (err) {
    return fail(err);
  }
}

/** action: submit (send to Meta for approval) or test (send the approved template to a number). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  if (!(await funnelTemplate(params.id))) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  const b = (await request.json().catch(() => ({}))) as { action?: string; phone?: string };
  try {
    if (b.action === 'submit') {
      const template = await submitPlatformWhatsAppTemplate(params.id);
      await logAdminAction(auth.admin.id, 'sales_flow_template_submit', 'platform_whatsapp_template', params.id);
      return NextResponse.json({ template });
    }
    if (b.action === 'test') {
      const digits = String(b.phone || '').replace(/\D/g, '');
      const res = await sendApprovedTemplateTest({ templateId: params.id, toPhone: digits.length === 10 ? `91${digits}` : digits, vars: ['Ramesh'] });
      return NextResponse.json({ ok: true, messageId: res.messageId });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return fail(err);
  }
}
