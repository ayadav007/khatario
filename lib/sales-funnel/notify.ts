import { businessTypeLabel, painPointLabel } from './default-flow';
import type { FlowSettings } from './definition';
import { mergeFlowData, type FunnelLead } from './leads';
import { siteBase } from './render';

const REPEAT_NOTIFY_MS = 30 * 60 * 1000;

function leadSummary(lead: FunnelLead): string {
  return [
    lead.name || lead.flow_data?.profile_name,
    lead.wa_phone ? `+${lead.wa_phone}` : lead.phone,
    lead.business_name,
    businessTypeLabel(lead.business_type),
    painPointLabel(lead.pain_point),
    lead.campaign_name || (lead.ad_id ? `ad ${lead.ad_id}` : null),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Push to platform admins, plus optional email / WhatsApp to the sales contact in flow settings. */
export async function notifySales(
  lead: FunnelLead,
  settings: FlowSettings,
  input: { reason: 'handoff' | 'message_while_handed_off'; text?: string },
): Promise<void> {
  if (input.reason === 'message_while_handed_off') {
    const last = lead.flow_data?.last_handoff_notify_at ? new Date(lead.flow_data.last_handoff_notify_at).getTime() : 0;
    if (Date.now() - last < REPEAT_NOTIFY_MS) return;
  }
  await mergeFlowData(lead, { last_handoff_notify_at: new Date().toISOString() }).catch(() => undefined);

  const path = `/admin/sales-flow?tab=pipeline&lead=${lead.id}`;
  const title =
    input.reason === 'handoff'
      ? `WhatsApp lead wants an expert: ${lead.name || lead.flow_data?.profile_name || lead.phone}`
      : `WhatsApp lead replied: ${lead.name || lead.flow_data?.profile_name || lead.phone}`;
  const body = [leadSummary(lead), input.text ? `"${input.text.slice(0, 160)}"` : null].filter(Boolean).join('\n').slice(0, 300);

  try {
    const { raisePlatformIncident } = await import('@/lib/platform-push');
    await raisePlatformIncident({ kind: 'sales_handoff', title, body, url: path, metadata: { lead_id: lead.id, reason: input.reason } });
  } catch (err) {
    console.error('[sales-funnel] push notify failed', err instanceof Error ? err.message : err);
  }

  const link = `${siteBase()}${path}`;
  if (settings.salesNotifyEmail?.trim()) {
    try {
      const { sendEmail } = await import('@/lib/email');
      await sendEmail({
        to: settings.salesNotifyEmail.trim(),
        subject: title,
        html: `<p>${body.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string).replace(/\n/g, '<br>')}</p><p><a href="${link}">Open lead and conversation</a></p>`,
      });
    } catch (err) {
      console.warn('[sales-funnel] email notify failed', err instanceof Error ? err.message : err);
    }
  }
  if (settings.salesNotifyPhone?.trim()) {
    try {
      const { sendTextMessage } = await import('@/lib/meta-whatsapp');
      // Free-form text only reaches the sales phone inside its own 24-hour window; failures are expected otherwise.
      await sendTextMessage({ to: settings.salesNotifyPhone, body: `${title}\n${body}\n${link}` });
    } catch (err) {
      console.warn('[sales-funnel] WhatsApp notify failed', err instanceof Error ? err.message : err);
    }
  }
}
