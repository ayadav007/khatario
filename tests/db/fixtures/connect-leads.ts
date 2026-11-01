/**
 * Seeding helpers for the Connect leads DB tests (kh_phase2_test only). Callers import `@/lib/db`
 * after setting DATABASE_URL, so this file only uses the shared query helper.
 */
import { randomInt, randomUUID } from 'crypto';
import { query } from '@/lib/db';

const digits = (n: number) => String(randomInt(10 ** (n - 1), 10 ** n));

/** A business with a stage-less inbox: one agent (inbox view only) and one supervisor (primary admin). */
export async function seedBusiness(tag: string): Promise<{ businessId: string; agentId: string; supervisorId: string }> {
  const businessId = randomUUID();
  const agentId = randomUUID();
  const supervisorId = randomUUID();
  const roleId = randomUUID();
  await query(
    `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
    [businessId, `Leads ${tag} ${businessId.slice(0, 6)}`],
  );
  await query(`INSERT INTO user_roles (id, business_id, role_name, role_key) VALUES ($1, $2, 'Agent', $3)`, [
    roleId,
    businessId,
    `cl_agent_${businessId.slice(0, 8)}`,
  ]);
  await query(`INSERT INTO role_permissions (role_id, module_key, can_view) VALUES ($1, 'whatsapp_inbox', true)`, [roleId]);
  await query(
    `INSERT INTO users (id, business_id, name, phone, is_primary_admin, role_id, is_active) VALUES ($1, $2, 'Agent', $3, false, $4, true)`,
    [agentId, businessId, `6${digits(9)}`, roleId],
  );
  await query(
    `INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Supervisor', $3, true, true)`,
    [supervisorId, businessId, `7${digits(9)}`],
  );
  return { businessId, agentId, supervisorId };
}

/** A 1:1 chat that has just received a message. */
export async function seedChat(businessId: string, opts: { phone?: string; name?: string } = {}): Promise<{ id: string; phone: string }> {
  const id = randomUUID();
  const phone = opts.phone ?? `91${digits(10)}`;
  await query(
    `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, whatsapp_display_name, last_message_at, last_message_direction)
     VALUES ($1, $2, $3, '919999900000', $3, $4, NOW(), 'incoming')`,
    [id, businessId, phone, opts.name ?? null],
  );
  return { id, phone };
}

/** Removes everything the helpers and the lead tests create, in foreign-key order. */
export async function cleanupBusinesses(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const del = (table: string, column = 'business_id') => query(`DELETE FROM ${table} WHERE ${column} = ANY($1::uuid[])`, [ids]);
  await del('leads');
  await del('whatsapp_followups');
  await del('whatsapp_automation_events');
  await del('whatsapp_lead_imports');
  await del('whatsapp_conversation_messages');
  await del('whatsapp_lead_profiles');
  await del('whatsapp_conversations');
  await del('whatsapp_pipeline_stages');
  await del('customers');
  await del('suppliers');
  await del('business_settings');
  await del('users');
  await del('user_roles');
  await del('businesses', 'id');
}
