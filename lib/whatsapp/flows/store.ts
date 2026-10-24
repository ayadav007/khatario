import { query, queryOne, queryRows } from '@/lib/db';
import {
  canPublish,
  emptyFlowDefinition,
  extractTriggers,
  parseFlowDefinition,
  type FlowDefinition,
  type FlowTriggers,
} from './schema';

export type FlowRow = {
  id: string;
  business_id: string;
  name: string;
  status: 'draft' | 'published' | 'inactive';
  version: number;
  definition: FlowDefinition;
  published_definition: FlowDefinition | null;
  triggers: FlowTriggers;
  created_at: string;
  updated_at: string;
};

function asDef(raw: unknown): FlowDefinition {
  const parsed = parseFlowDefinition(raw);
  return parsed.ok ? parsed.data : emptyFlowDefinition();
}

function row(r: Record<string, unknown>): FlowRow {
  return {
    id: String(r.id),
    business_id: String(r.business_id),
    name: String(r.name),
    status: r.status as FlowRow['status'],
    version: Number(r.version),
    definition: asDef(r.definition),
    published_definition: r.published_definition ? asDef(r.published_definition) : null,
    triggers: (r.triggers as FlowTriggers) || extractTriggers(asDef(r.definition)),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function listFlows(businessId: string): Promise<FlowRow[]> {
  const rows = await queryRows(
    `SELECT id, business_id, name, status, version, definition, published_definition, triggers, created_at, updated_at
       FROM whatsapp_flows WHERE business_id = $1 ORDER BY updated_at DESC`,
    [businessId],
  );
  return rows.map(row);
}

export async function getFlow(businessId: string, id: string): Promise<FlowRow | null> {
  const r = await queryOne(
    `SELECT id, business_id, name, status, version, definition, published_definition, triggers, created_at, updated_at
       FROM whatsapp_flows WHERE id = $1 AND business_id = $2`,
    [id, businessId],
  );
  return r ? row(r) : null;
}

export async function createFlow(
  businessId: string,
  userId: string,
  input: { name: string; definition?: FlowDefinition },
): Promise<FlowRow> {
  const definition = input.definition ?? emptyFlowDefinition();
  const parsed = parseFlowDefinition(definition);
  if (!parsed.ok) throw new Error(parsed.error);
  const triggers = extractTriggers(parsed.data);
  const r = await queryOne(
    `INSERT INTO whatsapp_flows (business_id, name, status, definition, triggers, created_by, updated_by)
     VALUES ($1, $2, 'draft', $3::jsonb, $4::jsonb, $5, $5)
     RETURNING id, business_id, name, status, version, definition, published_definition, triggers, created_at, updated_at`,
    [businessId, input.name.trim().slice(0, 255), JSON.stringify(parsed.data), JSON.stringify(triggers), userId],
  );
  if (!r) throw new Error('Could not create flow');
  return row(r);
}

export async function updateFlow(
  businessId: string,
  userId: string,
  id: string,
  patch: { name?: string; definition?: FlowDefinition },
): Promise<FlowRow | null> {
  const existing = await getFlow(businessId, id);
  if (!existing) return null;
  let definition = existing.definition;
  if (patch.definition) {
    const parsed = parseFlowDefinition(patch.definition);
    if (!parsed.ok) throw new Error(parsed.error);
    definition = parsed.data;
  }
  const name = patch.name?.trim() ? patch.name.trim().slice(0, 255) : existing.name;
  const triggers = extractTriggers(definition);
  const r = await queryOne(
    `UPDATE whatsapp_flows
        SET name = $3, definition = $4::jsonb, triggers = $5::jsonb, updated_by = $6
      WHERE id = $1 AND business_id = $2
      RETURNING id, business_id, name, status, version, definition, published_definition, triggers, created_at, updated_at`,
    [id, businessId, name, JSON.stringify(definition), JSON.stringify(triggers), userId],
  );
  return r ? row(r) : null;
}

export async function deleteFlow(businessId: string, id: string): Promise<boolean> {
  const res = await query(`DELETE FROM whatsapp_flows WHERE id = $1 AND business_id = $2`, [id, businessId]);
  return (res.rowCount ?? 0) > 0;
}

export async function publishFlow(businessId: string, userId: string, id: string): Promise<FlowRow | null> {
  const existing = await getFlow(businessId, id);
  if (!existing) return null;
  const pub = canPublish(existing.definition);
  if (!pub.ok) throw new Error(pub.error);
  const triggers = extractTriggers(existing.definition);
  const r = await queryOne(
    `UPDATE whatsapp_flows
        SET status = 'published',
            published_definition = definition,
            triggers = $3::jsonb,
            version = version + 1,
            updated_by = $4
      WHERE id = $1 AND business_id = $2
      RETURNING id, business_id, name, status, version, definition, published_definition, triggers, created_at, updated_at`,
    [id, businessId, JSON.stringify(triggers), userId],
  );
  return r ? row(r) : null;
}

export async function unpublishFlow(businessId: string, userId: string, id: string): Promise<FlowRow | null> {
  const r = await queryOne(
    `UPDATE whatsapp_flows SET status = 'draft', updated_by = $3
      WHERE id = $1 AND business_id = $2
      RETURNING id, business_id, name, status, version, definition, published_definition, triggers, created_at, updated_at`,
    [id, businessId, userId],
  );
  return r ? row(r) : null;
}

export type PublishedFlow = {
  id: string;
  name: string;
  version: number;
  definition: FlowDefinition;
  triggers: FlowTriggers;
};

export async function listPublishedFlows(businessId: string): Promise<PublishedFlow[]> {
  const rows = await queryRows(
    `SELECT id, name, version, published_definition, triggers
       FROM whatsapp_flows
      WHERE business_id = $1 AND status = 'published' AND published_definition IS NOT NULL`,
    [businessId],
  );
  return rows
    .map((r) => {
      const parsed = parseFlowDefinition(r.published_definition);
      if (!parsed.ok) return null;
      return {
        id: String(r.id),
        name: String(r.name),
        version: Number(r.version),
        definition: parsed.data,
        triggers: (r.triggers as FlowTriggers) || extractTriggers(parsed.data),
      };
    })
    .filter((x): x is PublishedFlow => x != null);
}

export type SessionRow = {
  id: string;
  flow_id: string;
  flow_version: number;
  current_node_id: string;
  context: Record<string, unknown>;
  expires_at: Date;
};

export async function getActiveSession(businessId: string, conversationId: string): Promise<SessionRow | null> {
  const r = await queryOne(
    `SELECT id, flow_id, flow_version, current_node_id, context, expires_at
       FROM whatsapp_flow_sessions
      WHERE business_id = $1 AND conversation_id = $2 AND status = 'active' AND expires_at > NOW()`,
    [businessId, conversationId],
  );
  if (!r) return null;
  return {
    id: String(r.id),
    flow_id: String(r.flow_id),
    flow_version: Number(r.flow_version),
    current_node_id: String(r.current_node_id),
    context: (r.context as Record<string, unknown>) || {},
    expires_at: new Date(r.expires_at),
  };
}

const SESSION_TTL_HOURS = 24;

export async function startSession(input: {
  businessId: string;
  conversationId: string;
  flowId: string;
  flowVersion: number;
  currentNodeId: string;
  context?: Record<string, unknown>;
}): Promise<SessionRow> {
  await query(
    `UPDATE whatsapp_flow_sessions SET status = 'ended', updated_at = NOW()
      WHERE conversation_id = $1 AND status = 'active'`,
    [input.conversationId],
  );
  const r = await queryOne(
    `INSERT INTO whatsapp_flow_sessions
       (business_id, conversation_id, flow_id, flow_version, current_node_id, context, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'active', NOW() + make_interval(hours => $7::int))
     RETURNING id, flow_id, flow_version, current_node_id, context, expires_at`,
    [
      input.businessId,
      input.conversationId,
      input.flowId,
      input.flowVersion,
      input.currentNodeId,
      JSON.stringify(input.context || {}),
      SESSION_TTL_HOURS,
    ],
  );
  if (!r) throw new Error('Could not start flow session');
  return {
    id: String(r.id),
    flow_id: String(r.flow_id),
    flow_version: Number(r.flow_version),
    current_node_id: String(r.current_node_id),
    context: (r.context as Record<string, unknown>) || {},
    expires_at: new Date(r.expires_at),
  };
}

export async function updateSession(
  sessionId: string,
  patch: { currentNodeId: string; context: Record<string, unknown> },
): Promise<void> {
  await query(
    `UPDATE whatsapp_flow_sessions
        SET current_node_id = $2, context = $3::jsonb, updated_at = NOW()
      WHERE id = $1 AND status = 'active'`,
    [sessionId, patch.currentNodeId, JSON.stringify(patch.context)],
  );
}

export async function endSession(sessionId: string, status: 'ended' | 'expired' = 'ended'): Promise<void> {
  await query(
    `UPDATE whatsapp_flow_sessions SET status = $2, updated_at = NOW() WHERE id = $1`,
    [sessionId, status],
  );
}

/** End every active flow for this chat (e.g. when a person resolves / takes over). */
export async function endActiveSessionsForConversation(
  businessId: string,
  conversationId: string,
): Promise<void> {
  await query(
    `UPDATE whatsapp_flow_sessions SET status = 'ended', updated_at = NOW()
      WHERE business_id = $1 AND conversation_id = $2 AND status = 'active'`,
    [businessId, conversationId],
  );
}
