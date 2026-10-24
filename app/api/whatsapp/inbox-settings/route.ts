export const dynamic = 'force-dynamic';

/**
 * Shared inbox settings.
 * GET /api/whatsapp/inbox-settings — auto-resolve switch and per-agent label rules
 * PUT /api/whatsapp/inbox-settings — { auto_resolve_enabled?, agent_rules?: [{ user_id, label_ids }] }
 *
 * An agent with label rules only sees unowned chats carrying one of those labels;
 * an agent without rules sees every unowned chat.
 */

import { NextResponse } from 'next/server';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadSettings(businessId: string) {
  const [settings, rules] = await Promise.all([
    queryOne<{ whatsapp_auto_resolve_enabled: boolean | null }>(
      `SELECT whatsapp_auto_resolve_enabled FROM business_settings WHERE business_id = $1`,
      [businessId],
    ),
    queryRows<{ user_id: string; label_id: string }>(
      `SELECT user_id::text AS user_id, label_id::text AS label_id
         FROM whatsapp_agent_label_rules WHERE business_id = $1`,
      [businessId],
    ),
  ]);
  const byUser = new Map<string, string[]>();
  for (const r of rules) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.label_id]);
  return {
    auto_resolve_enabled: settings?.whatsapp_auto_resolve_enabled ?? true,
    agent_rules: [...byUser.entries()].map(([user_id, label_ids]) => ({ user_id, label_ids })),
  };
}

export const GET = withWhatsAppPremiumApi({ module: 'settings', action: 'read' }, async ({ businessId }) => {
  try {
    return NextResponse.json(await loadSettings(businessId));
  } catch (error: any) {
    console.error('[inbox-settings] GET error:', error);
    return NextResponse.json({ error: 'Failed to load inbox settings' }, { status: 500 });
  }
});

export const PUT = withWhatsAppPremiumApi(
  { module: 'settings', action: 'update', parseJsonBody: true },
  async ({ businessId, body }) => {
    const { auto_resolve_enabled, agent_rules } = (body ?? {}) as {
      auto_resolve_enabled?: unknown;
      agent_rules?: unknown;
    };

    if (auto_resolve_enabled !== undefined && typeof auto_resolve_enabled !== 'boolean') {
      return NextResponse.json({ error: 'auto_resolve_enabled must be true or false' }, { status: 400 });
    }

    let rules: Array<{ user_id: string; label_ids: string[] }> | null = null;
    if (agent_rules !== undefined) {
      if (!Array.isArray(agent_rules)) {
        return NextResponse.json({ error: 'agent_rules must be a list' }, { status: 400 });
      }
      rules = [];
      for (const r of agent_rules as Array<{ user_id?: unknown; label_ids?: unknown }>) {
        if (typeof r?.user_id !== 'string' || !UUID_RE.test(r.user_id) || !Array.isArray(r.label_ids)) {
          return NextResponse.json({ error: 'Each rule needs a user_id and a list of label_ids' }, { status: 400 });
        }
        const labelIds = [...new Set(r.label_ids.filter((l): l is string => typeof l === 'string' && UUID_RE.test(l)))];
        rules.push({ user_id: r.user_id, label_ids: labelIds });
      }

      const userIds = [...new Set(rules.map((r) => r.user_id))];
      const labelIds = [...new Set(rules.flatMap((r) => r.label_ids))];
      if (userIds.length) {
        const members = await queryRows<{ id: string }>(
          `SELECT u.id::text AS id FROM users u
            WHERE u.id = ANY($2::uuid[])
              AND (u.business_id = $1
                   OR EXISTS (SELECT 1 FROM user_businesses ub WHERE ub.user_id = u.id AND ub.business_id = $1))`,
          [businessId, userIds],
        );
        if (members.length !== userIds.length) {
          return NextResponse.json({ error: 'A rule refers to someone who is not on your team' }, { status: 400 });
        }
      }
      if (labelIds.length) {
        const labels = await queryRows<{ id: string }>(
          `SELECT id::text AS id FROM whatsapp_conversation_labels WHERE business_id = $1 AND id = ANY($2::uuid[])`,
          [businessId, labelIds],
        );
        if (labels.length !== labelIds.length) {
          return NextResponse.json({ error: 'A rule refers to a label that no longer exists' }, { status: 400 });
        }
      }
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      if (typeof auto_resolve_enabled === 'boolean') {
        await client.query(
          `INSERT INTO business_settings (business_id, whatsapp_auto_resolve_enabled)
           VALUES ($1, $2)
           ON CONFLICT (business_id) DO UPDATE SET whatsapp_auto_resolve_enabled = EXCLUDED.whatsapp_auto_resolve_enabled`,
          [businessId, auto_resolve_enabled],
        );
      }
      if (rules) {
        await client.query(`DELETE FROM whatsapp_agent_label_rules WHERE business_id = $1`, [businessId]);
        for (const r of rules) {
          for (const labelId of r.label_ids) {
            await client.query(
              `INSERT INTO whatsapp_agent_label_rules (business_id, user_id, label_id)
               VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
              [businessId, r.user_id, labelId],
            );
          }
        }
      }
      await client.query('COMMIT');
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[inbox-settings] PUT error:', error);
      return NextResponse.json({ error: 'Failed to save inbox settings' }, { status: 500 });
    } finally {
      client.release();
    }

    return NextResponse.json({ success: true, ...(await loadSettings(businessId)) });
  },
);
