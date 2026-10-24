import { query, queryRows } from '@/lib/db';
import type { AgentSettings } from './types';
import { performHandoff } from './conversation';

export interface LeadApplyResult {
  saved: string[];
  qualified: boolean;
}

/** Answers already collected for this chat, keyed by field. */
export async function loadLeadAnswers(
  businessId: string,
  conversationId: string,
): Promise<Record<string, string>> {
  const rows = await queryRows<{ field_key: string; field_value: string | null }>(
    `SELECT field_key, field_value FROM whatsapp_conversation_custom_fields
      WHERE business_id = $1 AND conversation_id = $2`,
    [businessId, conversationId],
  ).catch(() => []);
  const out: Record<string, string> = {};
  for (const r of rows) if (r.field_value) out[r.field_key] = r.field_value;
  return out;
}

async function addLabels(businessId: string, conversationId: string, labels: string[]): Promise<void> {
  for (const name of labels) {
    const label = await queryRows<{ id: string }>(
      `INSERT INTO whatsapp_conversation_labels (business_id, name)
       VALUES ($1, $2)
       ON CONFLICT (business_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [businessId, name],
    );
    if (!label[0]) continue;
    await query(
      `INSERT INTO whatsapp_conversation_label_assignments (conversation_id, label_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [conversationId, label[0].id],
    );
  }
}

/**
 * Save LEAD_DATA answers to the chat's custom fields. The first time every required
 * question has an answer, apply the owner's "when qualified" actions.
 */
export async function applyLeadAnswers(
  businessId: string,
  conversationId: string,
  settings: AgentSettings,
  leadData: Record<string, string>,
  opts: { customerLabel?: string } = {},
): Promise<LeadApplyResult> {
  const lead = settings.leadSkill;
  const result: LeadApplyResult = { saved: [], qualified: false };
  if (!lead.enabled || !lead.questions.length) return result;

  const allowed = new Set(lead.questions.map((q) => q.fieldKey));
  const entries = Object.entries(leadData).filter(([k, v]) => allowed.has(k) && v.trim());
  if (!entries.length) return result;

  const before = await loadLeadAnswers(businessId, conversationId);
  const required = lead.questions.filter((q) => q.required).map((q) => q.fieldKey);
  const wasQualified = required.length > 0 && required.every((k) => before[k]);

  for (const [key, value] of entries) {
    await query(
      `INSERT INTO whatsapp_conversation_custom_fields (conversation_id, business_id, field_key, field_value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversation_id, field_key)
       DO UPDATE SET field_value = EXCLUDED.field_value`,
      [conversationId, businessId, key, value.trim()],
    );
    result.saved.push(key);
  }

  const after = { ...before, ...Object.fromEntries(entries) };
  const nowQualified = required.length > 0 ? required.every((k) => after[k]) : true;
  if (!nowQualified || wasQualified) return result;
  result.qualified = true;

  const q = lead.onQualify;
  try {
    if (q.labels.length) await addLabels(businessId, conversationId, q.labels);
    if (q.leadStatus) {
      await query(
        `UPDATE whatsapp_conversations SET lead_status = $3 WHERE id = $1 AND business_id = $2`,
        [conversationId, businessId, q.leadStatus],
      );
    }
    if (q.handoff) {
      await performHandoff(businessId, conversationId, settings, {
        assignTo: q.assignTo || undefined,
        customerLabel: opts.customerLabel,
      });
    } else if (q.assignTo && /^[0-9a-f-]{36}$/i.test(q.assignTo)) {
      await query(
        `UPDATE whatsapp_conversations SET assigned_to = $3::uuid WHERE id = $1 AND business_id = $2`,
        [conversationId, businessId, q.assignTo],
      );
    }
  } catch (err) {
    console.warn('[ai-agent] onQualify actions failed:', err instanceof Error ? err.message : err);
  }
  return result;
}
