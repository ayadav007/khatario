import { query, queryOne, queryRows } from '@/lib/db';
import { todayIst } from '@/lib/gst/time-limits';
import { appBaseUrl, inr, renderCards } from '@/lib/insights/format';
import { runInsightTool } from '@/lib/insights/tools';
import { canSeeBusinessData } from '@/lib/insights/turn';
import {
  buildGraphComponents,
  createMessageTemplate,
  listMessageTemplates,
  mapMetaStatus,
  type TemplateStatusUpdate,
} from '@/lib/meta-whatsapp';
import { businessTransport, sendBusinessTemplate, sendBusinessText, type BusinessTransport } from './business-transport';

export const SUMMARY_TEMPLATE_NAME = 'khatario_daily_summary';
export const SUMMARY_TEMPLATE_LANGUAGE = 'en';
export const SUMMARY_TEMPLATE_BODY =
  "Today's Khatario summary: sales {{1}} from {{2}} bills, money received {{3}}, overdue from customers {{4}}. Reply SUMMARY for the full details.";
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SummaryLink {
  business_id: string;
  user_id: string;
  linked_phone: string | null;
  daily_summary_enabled: boolean;
  daily_summary_time: string;
  last_summary_sent_on: string | null;
  last_owner_message_at: string | Date | null;
  template_status: string | null;
}

/** Current date and HH:MM in Indian time. */
export function nowIst(now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Due once the chosen time has passed today (Indian time) and nothing was sent today. */
export function isSummaryDue(link: Pick<SummaryLink, 'daily_summary_enabled' | 'linked_phone' | 'daily_summary_time' | 'last_summary_sent_on'>, now = new Date()): boolean {
  if (!link.daily_summary_enabled || !link.linked_phone) return false;
  const { date, time } = nowIst(now);
  if (link.last_summary_sent_on && String(link.last_summary_sent_on).slice(0, 10) >= date) return false;
  return String(link.daily_summary_time).slice(0, 5) <= time;
}

export type SummaryDelivery = 'text' | 'template' | 'no_template';

/** QR can always send text; Cloud API only inside 24 hours of the owner's last message, else an approved template. */
export function chooseDelivery(
  transport: BusinessTransport,
  lastOwnerMessageAt: string | Date | null,
  templateStatus: string | null,
  now = new Date(),
): SummaryDelivery {
  if (transport === 'baileys') return 'text';
  if (lastOwnerMessageAt && now.getTime() - new Date(lastOwnerMessageAt).getTime() < WINDOW_MS - 5 * 60_000) return 'text';
  return templateStatus === 'approved' ? 'template' : 'no_template';
}

export interface SummaryFigures {
  sales: number;
  bills: number;
  received: number;
  overdue: number | null;
}

/** The 4 template variables: sales, bills, received, overdue. Meta rejects empty values. */
export function summaryTemplateVars(f: SummaryFigures): string[] {
  return [inr(f.sales), String(f.bills), inr(f.received), f.overdue == null ? 'not on your plan' : inr(f.overdue)];
}

export async function buildOwnerSummary(businessId: string, userId: string, today = todayIst()) {
  const res = await runInsightTool({ businessId, userId, today }, { name: 'daily_summary', args: { day: 'today' } });
  const data = (res.data ?? {}) as {
    sales?: { sales_with_tax: number; invoice_count: number };
    received?: number;
    overdueReceivable?: { age_0_30: number; age_30_60: number; age_60_90: number; age_90_plus: number } | null;
  };
  const o = data.overdueReceivable;
  const figures: SummaryFigures = {
    sales: data.sales?.sales_with_tax ?? 0,
    bills: data.sales?.invoice_count ?? 0,
    received: data.received ?? 0,
    overdue: o ? o.age_0_30 + o.age_30_60 + o.age_60_90 + o.age_90_plus : null,
  };
  const text = `${renderCards(res.cards, 'whatsapp', appBaseUrl())}\n\nAsk me anything, e.g. "who owes me the most" or "top products this month".`;
  return { ok: res.ok, text, figures };
}

export type SendSummaryResult =
  | { sent: true; delivery: 'text' | 'template' }
  | { sent: false; reason: 'not_linked' | 'not_owner' | 'no_template' | 'failed'; error?: string };

/** Sends today's summary to the linked owner. `force` (Send test now) ignores the time and the once-a-day guard. */
export async function sendOwnerSummary(businessId: string, opts: { force?: boolean; now?: Date } = {}): Promise<SendSummaryResult> {
  const link = await queryOne<SummaryLink>(
    `SELECT business_id, user_id, linked_phone, daily_summary_enabled, daily_summary_time::text AS daily_summary_time,
            to_char(last_summary_sent_on, 'YYYY-MM-DD') AS last_summary_sent_on, last_owner_message_at, template_status
       FROM owner_whatsapp_links WHERE business_id = $1`,
    [businessId],
  );
  if (!link?.linked_phone) return { sent: false, reason: 'not_linked' };
  const { date } = nowIst(opts.now);
  if (!(await canSeeBusinessData(link.user_id, businessId))) {
    if (!opts.force) {
      await query(
        `UPDATE owner_whatsapp_links SET last_summary_sent_on = $2::date, last_summary_error = 'not_primary_admin', updated_at = NOW() WHERE business_id = $1`,
        [businessId, date],
      );
    }
    return { sent: false, reason: 'not_owner' };
  }

  const transport = await businessTransport(businessId);
  const delivery = chooseDelivery(transport, link.last_owner_message_at, link.template_status, opts.now);
  const mark = (error: string | null) =>
    query(
      `UPDATE owner_whatsapp_links
          SET last_summary_sent_on = CASE WHEN $3::text IS NULL THEN $2::date ELSE last_summary_sent_on END,
              last_summary_error = $3, updated_at = NOW()
        WHERE business_id = $1`,
      [businessId, date, error],
    );

  if (delivery === 'no_template') {
    if (!opts.force) await mark('template_pending');
    return { sent: false, reason: 'no_template' };
  }
  try {
    const summary = await buildOwnerSummary(businessId, link.user_id, date);
    if (delivery === 'text') {
      await sendBusinessText(businessId, link.linked_phone, summary.text);
    } else {
      await sendBusinessTemplate(businessId, link.linked_phone, {
        name: SUMMARY_TEMPLATE_NAME,
        language: SUMMARY_TEMPLATE_LANGUAGE,
        components: [{ type: 'body', parameters: summaryTemplateVars(summary.figures).map((text) => ({ type: 'text', text })) }],
      });
    }
    if (!opts.force) await mark(null);
    return { sent: true, delivery };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : 'send failed';
    // Mark the day as attempted so a broken connection doesn't retry every 15 minutes all night.
    if (!opts.force) {
      await query(
        `UPDATE owner_whatsapp_links SET last_summary_sent_on = $2::date, last_summary_error = $3, updated_at = NOW() WHERE business_id = $1`,
        [businessId, date, message],
      ).catch(() => undefined);
    }
    return { sent: false, reason: 'failed', error: message };
  }
}

/** Links whose summary is due now (Indian time), for the 15-minute cron. */
export async function dueSummaryBusinessIds(now = new Date()): Promise<string[]> {
  const { date, time } = nowIst(now);
  const rows = await queryRows<{ business_id: string }>(
    `SELECT business_id FROM owner_whatsapp_links
      WHERE daily_summary_enabled AND linked_phone IS NOT NULL
        AND (last_summary_sent_on IS NULL OR last_summary_sent_on < $1::date)
        AND daily_summary_time <= $2::time
      ORDER BY daily_summary_time
      LIMIT 500`,
    [date, time],
  );
  return rows.map((r) => r.business_id);
}

/** Creates the summary template on the business's own WhatsApp Business Account. */
export async function createSummaryTemplate(businessId: string): Promise<string> {
  const components = buildGraphComponents({
    category: 'UTILITY',
    bodyText: SUMMARY_TEMPLATE_BODY,
    exampleVars: ['₹42,500', '18', '₹30,000', '₹1,20,000'],
  });
  let status: string;
  try {
    const res = await createMessageTemplate({
      businessId,
      name: SUMMARY_TEMPLATE_NAME,
      language: SUMMARY_TEMPLATE_LANGUAGE,
      category: 'UTILITY',
      components,
    });
    status = mapMetaStatus(res.status);
  } catch (err) {
    // Already created earlier (for example from another Khatario install): read its status instead.
    if (err instanceof Error && /already exists|duplicate/i.test(err.message)) status = await refreshTemplateStatus(businessId);
    else throw err;
  }
  await query(
    `UPDATE owner_whatsapp_links SET template_name = $2, template_status = $3, updated_at = NOW() WHERE business_id = $1`,
    [businessId, SUMMARY_TEMPLATE_NAME, status],
  );
  return status;
}

export async function refreshTemplateStatus(businessId: string): Promise<string> {
  const templates = await listMessageTemplates(businessId);
  const t = templates.find((x) => x.name === SUMMARY_TEMPLATE_NAME && (!x.language || x.language === SUMMARY_TEMPLATE_LANGUAGE));
  const status = t ? mapMetaStatus(t.status) : 'missing';
  await query(
    `UPDATE owner_whatsapp_links SET template_name = $2, template_status = $3, updated_at = NOW() WHERE business_id = $1`,
    [businessId, t ? SUMMARY_TEMPLATE_NAME : null, t ? status : null],
  );
  return status;
}

/** Template status webhook on the tenant's own app. */
export async function applyTenantTemplateStatus(businessId: string, update: TemplateStatusUpdate): Promise<void> {
  if (update.message_template_name !== SUMMARY_TEMPLATE_NAME) return;
  await query(
    `UPDATE owner_whatsapp_links SET template_status = $2, updated_at = NOW() WHERE business_id = $1`,
    [businessId, mapMetaStatus(update.event)],
  );
}