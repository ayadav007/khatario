import { randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { canSeeBusinessData } from '@/lib/insights/turn';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { businessTransport } from '@/lib/whatsapp/business-transport';
import { clearOwnerLinkCache } from '@/lib/whatsapp/inbound-router';
import { createSummaryTemplate, refreshTemplateStatus, sendOwnerSummary } from '@/lib/whatsapp/owner-summary';

export const dynamic = 'force-dynamic';

const CODE_TTL_MIN = 15;

type LinkRow = {
  linked_phone: string | null;
  linked_at: string | null;
  self_chat: boolean;
  link_code: string | null;
  link_code_expires_at: string | null;
  daily_summary_enabled: boolean;
  daily_summary_time: string;
  last_summary_sent_on: string | null;
  last_summary_error: string | null;
  last_owner_message_at: string | null;
  template_status: string | null;
};

async function authorize(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  if (!(await canSeeBusinessData(auth.userId, auth.businessId))) {
    return NextResponse.json({ error: 'Only the primary admin can set up owner updates.' }, { status: 403 });
  }
  return auth;
}

async function state(businessId: string) {
  const [link, session, transport] = await Promise.all([
    queryOne<LinkRow>(
      `SELECT linked_phone, linked_at, self_chat, link_code, link_code_expires_at, daily_summary_enabled,
              to_char(daily_summary_time, 'HH24:MI') AS daily_summary_time,
              to_char(last_summary_sent_on, 'YYYY-MM-DD') AS last_summary_sent_on, last_summary_error,
              last_owner_message_at, template_status
         FROM owner_whatsapp_links WHERE business_id = $1`,
      [businessId],
    ),
    queryOne<{ phone_number: string | null; status: string | null }>(
      `SELECT phone_number, status FROM whatsapp_sessions WHERE business_id = $1`,
      [businessId],
    ).catch(() => null),
    businessTransport(businessId),
  ]);
  const codeActive = Boolean(link?.link_code && link.link_code_expires_at && new Date(link.link_code_expires_at) > new Date());
  return {
    transport,
    businessPhone: transport === 'baileys' ? session?.phone_number ?? null : null,
    qrConnected: session?.status === 'connected',
    link: link
      ? {
          linkedPhone: link.linked_phone,
          linkedAt: link.linked_at,
          selfChat: link.self_chat,
          code: codeActive ? link.link_code : null,
          codeExpiresAt: codeActive ? link.link_code_expires_at : null,
          dailySummaryEnabled: link.daily_summary_enabled,
          dailySummaryTime: link.daily_summary_time,
          lastSummarySentOn: link.last_summary_sent_on,
          lastSummaryError: link.last_summary_error,
          lastOwnerMessageAt: link.last_owner_message_at,
          templateStatus: link.template_status,
        }
      : null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await state(auth.businessId));
  } catch (err) {
    console.error('[owner-link] GET failed:', err);
    return NextResponse.json({ error: 'Owner updates are not available yet. Please try again later.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const { businessId, userId } = auth;

  try {
    switch (body.action) {
      case 'start': {
        const code = String(randomInt(1000, 10000));
        await query(
          `INSERT INTO owner_whatsapp_links (business_id, user_id, link_code, link_code_expires_at)
           VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)
           ON CONFLICT (business_id) DO UPDATE
              SET user_id = EXCLUDED.user_id, link_code = EXCLUDED.link_code,
                  link_code_expires_at = EXCLUDED.link_code_expires_at, updated_at = NOW()`,
          [businessId, userId, code, String(CODE_TTL_MIN)],
        );
        clearOwnerLinkCache(businessId);
        break;
      }
      case 'cancel_code':
        await query(`UPDATE owner_whatsapp_links SET link_code = NULL, link_code_expires_at = NULL, updated_at = NOW() WHERE business_id = $1`, [businessId]);
        clearOwnerLinkCache(businessId);
        break;
      case 'unlink':
        await query(
          `UPDATE owner_whatsapp_links
              SET linked_phone = NULL, linked_at = NULL, self_chat = FALSE, link_code = NULL, link_code_expires_at = NULL, updated_at = NOW()
            WHERE business_id = $1`,
          [businessId],
        );
        clearOwnerLinkCache(businessId);
        break;
      case 'test_summary': {
        const res = await sendOwnerSummary(businessId, { force: true });
        return NextResponse.json({ ...(await state(businessId)), test: res });
      }
      case 'create_template': {
        const status = await createSummaryTemplate(businessId);
        return NextResponse.json({ ...(await state(businessId)), templateStatus: status });
      }
      case 'refresh_template':
        await refreshTemplateStatus(businessId);
        break;
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json(await state(businessId));
  } catch (err) {
    console.error('[owner-link] POST failed:', err);
    const message = err instanceof Error ? err.message : 'Something went wrong';
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authorize(request);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => ({}))) as { dailySummaryEnabled?: unknown; dailySummaryTime?: unknown };
  const enabled = typeof body.dailySummaryEnabled === 'boolean' ? body.dailySummaryEnabled : null;
  const time = typeof body.dailySummaryTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.dailySummaryTime) ? body.dailySummaryTime : null;
  if (enabled === null && time === null) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  await query(
    `UPDATE owner_whatsapp_links
        SET daily_summary_enabled = COALESCE($2, daily_summary_enabled),
            daily_summary_time = COALESCE($3::time, daily_summary_time),
            updated_at = NOW()
      WHERE business_id = $1`,
    [auth.businessId, enabled, time],
  );
  return NextResponse.json(await state(auth.businessId));
}
