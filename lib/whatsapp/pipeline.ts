/**
 * Connect sales pipeline: per-business stages, the board and the dashboard. Deals live on leads
 * (lib/leads/core.ts writes them). Business identity always comes from the session.
 */
import { query, queryOne, queryRows } from '@/lib/db';
import type { InboxViewer } from '@/lib/whatsapp/inbox-ownership';
// visibility.ts imports neither lib/leads/core nor chat-deal, so this does not close a cycle with core.
import { leadVisibilityClause } from '@/lib/leads/visibility';

export const STAGE_KINDS = ['open', 'won', 'lost'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_COLORS = ['slate', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'violet'] as const;
export type StageColor = (typeof STAGE_COLORS)[number];

/** Old whatsapp_conversations.lead_status values; still written so filters, export and the AI agent agree. */
export type LegacyLeadStatus = 'new' | 'interested' | 'follow_up' | 'converted' | 'lost';

export const MAX_STAGES = 15;
const BOARD_CARDS_PER_STAGE = 50;

export interface PipelineStage {
  id: string;
  name: string;
  color: StageColor;
  position: number;
  kind: StageKind;
  legacy_key: LegacyLeadStatus | null;
}

export interface DealPatch {
  stageId?: string | null;
  dealValue?: number | null;
  expectedCloseOn?: string | null;
  lostReason?: string | null;
}

/** Who moved the deal; shown in the timeline. */
export type DealActor = { source: 'agent'; userId: string } | { source: 'flow' | 'ai' | 'auto' };

export interface DealView {
  stage_id: string | null;
  deal_value: number | null;
  expected_close_on: string | null;
  lost_reason: string | null;
  stage_changed_at: string | null;
  /** Where the lead came from (first touch); null = direct. */
  source: string | null;
  source_detail: Record<string, unknown> | null;
}

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
  ) {
    super(message);
  }
}

const DEFAULT_STAGES: Array<Omit<PipelineStage, 'id'>> = [
  { name: 'New', color: 'blue', position: 0, kind: 'open', legacy_key: 'new' },
  { name: 'Interested', color: 'amber', position: 1, kind: 'open', legacy_key: 'interested' },
  { name: 'Follow up', color: 'violet', position: 2, kind: 'open', legacy_key: 'follow_up' },
  { name: 'Won', color: 'green', position: 3, kind: 'won', legacy_key: 'converted' },
  { name: 'Lost', color: 'red', position: 4, kind: 'lost', legacy_key: 'lost' },
];

const STAGE_COLUMNS = 'id::text AS id, name, color, position, kind, legacy_key';

export async function listStages(businessId: string): Promise<PipelineStage[]> {
  return queryRows<PipelineStage>(
    `SELECT ${STAGE_COLUMNS} FROM whatsapp_pipeline_stages WHERE business_id = $1 ORDER BY position, created_at`,
    [businessId],
  );
}

/** The business's stages, creating the five defaults the first time. */
export async function ensureStages(businessId: string): Promise<PipelineStage[]> {
  const existing = await listStages(businessId);
  if (existing.length) return existing;
  for (const s of DEFAULT_STAGES) {
    await query(
      `INSERT INTO whatsapp_pipeline_stages (business_id, name, color, position, kind, legacy_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [businessId, s.name, s.color, s.position, s.kind, s.legacy_key],
    );
  }
  return listStages(businessId);
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw new PipelineError('Stage name is required', 400, 'NAME_REQUIRED');
  if (name.length > 60) throw new PipelineError('Stage name is too long (60 characters max)', 400, 'NAME_TOO_LONG');
  return name;
}

function cleanColor(raw: unknown): StageColor {
  return (STAGE_COLORS as readonly string[]).includes(raw as string) ? (raw as StageColor) : 'slate';
}

function cleanKind(raw: unknown): StageKind {
  return (STAGE_KINDS as readonly string[]).includes(raw as string) ? (raw as StageKind) : 'open';
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23505';
}

export async function createStage(
  businessId: string,
  input: { name: unknown; color?: unknown; kind?: unknown },
): Promise<PipelineStage> {
  const stages = await ensureStages(businessId);
  if (stages.length >= MAX_STAGES) throw new PipelineError(`A pipeline can have at most ${MAX_STAGES} stages`, 400, 'TOO_MANY');
  const name = cleanName(input.name);
  const kind = cleanKind(input.kind);
  // New open stages go before the first won/lost stage; won/lost go at the end.
  const firstClosed = stages.find((s) => s.kind !== 'open');
  const position = kind === 'open' && firstClosed ? firstClosed.position : Math.max(-1, ...stages.map((s) => s.position)) + 1;
  try {
    if (kind === 'open' && firstClosed) {
      await query(
        `UPDATE whatsapp_pipeline_stages SET position = position + 1 WHERE business_id = $1 AND position >= $2`,
        [businessId, position],
      );
    }
    const row = await queryOne<PipelineStage>(
      `INSERT INTO whatsapp_pipeline_stages (business_id, name, color, position, kind)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${STAGE_COLUMNS}`,
      [businessId, name, cleanColor(input.color), position, kind],
    );
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new PipelineError('A stage with this name already exists', 409, 'DUPLICATE');
    throw err;
  }
}

export async function updateStage(
  businessId: string,
  stageId: string,
  input: { name?: unknown; color?: unknown; kind?: unknown },
): Promise<PipelineStage> {
  const sets: string[] = [];
  const values: unknown[] = [stageId, businessId];
  if (input.name !== undefined) {
    values.push(cleanName(input.name));
    sets.push(`name = $${values.length}`);
  }
  if (input.color !== undefined) {
    values.push(cleanColor(input.color));
    sets.push(`color = $${values.length}`);
  }
  if (input.kind !== undefined) {
    values.push(cleanKind(input.kind));
    sets.push(`kind = $${values.length}`);
  }
  if (!sets.length) throw new PipelineError('Nothing to update', 400, 'EMPTY');
  try {
    const row = await queryOne<PipelineStage>(
      `UPDATE whatsapp_pipeline_stages SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $1::uuid AND business_id = $2
        RETURNING ${STAGE_COLUMNS}`,
      values,
    );
    if (!row) throw new PipelineError('Stage not found', 404, 'NOT_FOUND');
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw new PipelineError('A stage with this name already exists', 409, 'DUPLICATE');
    throw err;
  }
}

/** Sets board order from a full list of this business's stage ids. */
export async function reorderStages(businessId: string, order: unknown): Promise<PipelineStage[]> {
  const stages = await listStages(businessId);
  const ids = Array.isArray(order) ? order.filter((x): x is string => typeof x === 'string') : [];
  const known = new Set(stages.map((s) => s.id));
  if (ids.length !== stages.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
    throw new PipelineError('Send every stage exactly once', 400, 'BAD_ORDER');
  }
  await query(
    `UPDATE whatsapp_pipeline_stages s SET position = o.pos - 1, updated_at = NOW()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, pos)
      WHERE s.id = o.id AND s.business_id = $1`,
    [businessId, ids],
  );
  return listStages(businessId);
}

/** Deletes a stage after moving its leads to `moveToId` (or off the board when null). */
export async function deleteStage(businessId: string, stageId: string, moveToId: string | null): Promise<void> {
  const stages = await listStages(businessId);
  if (!stages.some((s) => s.id === stageId)) throw new PipelineError('Stage not found', 404, 'NOT_FOUND');
  if (stages.length <= 1) throw new PipelineError('Keep at least one stage', 400, 'LAST_STAGE');
  if (moveToId && (moveToId === stageId || !stages.some((s) => s.id === moveToId))) {
    throw new PipelineError('Pick another stage to move these leads to', 400, 'BAD_TARGET');
  }
  await query(
    `UPDATE leads SET stage_id = $3::uuid, stage_changed_at = NOW(), updated_at = NOW()
      WHERE business_id = $1 AND stage_id = $2::uuid`,
    [businessId, stageId, moveToId],
  );
  await query(`DELETE FROM whatsapp_pipeline_stages WHERE id = $1::uuid AND business_id = $2`, [stageId, businessId]);
}

export interface BoardCard {
  /** The lead's id. */
  id: string;
  /** The lead's chat, if it has one. */
  conversation_id: string | null;
  lead_type: 'new' | 'existing';
  stage_id: string;
  name: string;
  phone: string;
  profile_picture_url: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
  deal_value: number | null;
  expected_close_on: string | null;
  stage_changed_at: string | null;
  owner_id: string | null;
  owner_name: string | null;
  temperature: string | null;
  lead_score: number | null;
  /** AI summary of the chat, rewritten a few minutes after it goes quiet. */
  summary: string | null;
  /** The lead is linked to one of the business's customers. */
  is_customer: boolean;
  next_followup_at: string | null;
  source: string | null;
}

export interface BoardColumn extends PipelineStage {
  count: number;
  total_value: number;
  cards: BoardCard[];
}

export interface BoardFilters {
  ownerId?: string | null;
  /** A lead source key, or 'direct' for leads with none. */
  source?: string | null;
  labelId?: string | null;
  search?: string | null;
  /** Won and lost columns only show deals closed in this many days. */
  closedDays?: number;
  /** Load more cards for one stage. */
  stageId?: string | null;
  offset?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadBoard(viewer: InboxViewer, filters: BoardFilters = {}): Promise<BoardColumn[]> {
  const stages = await ensureStages(viewer.businessId);
  const params: unknown[] = [viewer.businessId];
  const where: string[] = ['l.business_id = $1', 'l.stage_id IS NOT NULL', `COALESCE(c.status, 'active') <> 'blocked'`];
  const vis = leadVisibilityClause(viewer, 'l', 'c', params.length + 1);
  where.push(vis.sql);
  params.push(...vis.params);

  if (filters.ownerId && UUID_RE.test(filters.ownerId)) {
    params.push(filters.ownerId);
    where.push(`l.owner_id = $${params.length}::uuid`);
  }
  if (filters.source === 'direct') {
    where.push('l.source IS NULL');
  } else if (filters.source && /^[a-z_]{2,16}$/.test(filters.source)) {
    params.push(filters.source);
    where.push(`l.source = $${params.length}`);
  }
  if (filters.labelId && UUID_RE.test(filters.labelId)) {
    params.push(filters.labelId);
    where.push(
      `EXISTS (SELECT 1 FROM whatsapp_conversation_label_assignments la WHERE la.conversation_id = c.id AND la.label_id = $${params.length}::uuid)`,
    );
  }
  const search = filters.search?.trim();
  if (search) {
    params.push(`%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    const p = `$${params.length}`;
    where.push(
      `(l.contact_name ILIKE ${p} OR c.whatsapp_display_name ILIKE ${p} OR l.contact_phone ILIKE ${p} OR cust.name ILIKE ${p})`,
    );
  }
  const closedDays = Math.min(Math.max(Math.floor(filters.closedDays ?? 90), 1), 3650);
  params.push(closedDays);
  where.push(`(s.kind = 'open' OR l.stage_changed_at >= NOW() - ($${params.length}::int * INTERVAL '1 day'))`);

  const base = `
      FROM leads l
      JOIN whatsapp_pipeline_stages s ON s.id = l.stage_id AND s.business_id = l.business_id
      LEFT JOIN whatsapp_conversations c ON c.id = l.conversation_id AND c.business_id = l.business_id
      LEFT JOIN customers cust ON cust.id = l.customer_id AND cust.business_id = l.business_id
      LEFT JOIN users u ON u.id = l.owner_id
      LEFT JOIN whatsapp_lead_profiles lp ON lp.conversation_id = c.id AND lp.business_id = l.business_id
     WHERE ${where.join(' AND ')}`;

  const totals = await queryRows<{ stage_id: string; count: number; total_value: number }>(
    `SELECT l.stage_id::text AS stage_id, COUNT(*)::int AS count, COALESCE(SUM(l.deal_value), 0)::float8 AS total_value
     ${base}
     GROUP BY l.stage_id`,
    params,
  );

  const cardParams = [...params];
  let stageFilter = '';
  if (filters.stageId && UUID_RE.test(filters.stageId)) {
    cardParams.push(filters.stageId);
    stageFilter = `AND l.stage_id = $${cardParams.length}::uuid`;
  }
  const offset = Math.max(Math.floor(filters.offset ?? 0), 0);
  cardParams.push(offset, BOARD_CARDS_PER_STAGE);
  const pOffset = `$${cardParams.length - 1}`;
  const pLimit = `$${cardParams.length}`;

  const cards = await queryRows<BoardCard>(
    `SELECT * FROM (
       SELECT l.id::text AS id, l.conversation_id::text AS conversation_id, l.lead_type, l.stage_id::text AS stage_id,
              COALESCE(NULLIF(cust.name, ''), NULLIF(l.contact_name, ''), NULLIF(c.whatsapp_display_name, ''), l.contact_phone) AS name,
              l.contact_phone AS phone, c.profile_picture_url, c.last_message_text, c.last_message_at,
              l.deal_value::float8 AS deal_value, to_char(l.expected_close_on, 'YYYY-MM-DD') AS expected_close_on,
              l.stage_changed_at,
              l.owner_id::text AS owner_id, u.name AS owner_name,
              lp.lead_status AS temperature, lp.lead_score, NULLIF(lp.ai_summary, '') AS summary,
              (l.customer_id IS NOT NULL) AS is_customer, l.source,
              (SELECT MIN(f.due_at) FROM whatsapp_followups f
                WHERE f.status = 'pending'
                  AND (f.lead_id = l.id OR (f.lead_id IS NULL AND f.conversation_id = l.conversation_id))) AS next_followup_at,
              ROW_NUMBER() OVER (PARTITION BY l.stage_id ORDER BY l.stage_changed_at DESC NULLS LAST, l.id) AS rn
       ${base} ${stageFilter}
     ) ranked
     WHERE rn > ${pOffset} AND rn <= ${pOffset} + ${pLimit}
     ORDER BY rn`,
    cardParams,
  ).then((rows) => rows.map(({ rn: _rn, ...card }: BoardCard & { rn?: number }) => card));

  return stages
    .filter((s) => !filters.stageId || s.id === filters.stageId)
    .map((s) => {
      const t = totals.find((x) => x.stage_id === s.id);
      return { ...s, count: t?.count ?? 0, total_value: t?.total_value ?? 0, cards: cards.filter((c) => c.stage_id === s.id) };
    });
}

export interface PipelineSummary {
  stages: Array<PipelineStage & { count: number; total_value: number }>;
  days: number;
  won: { count: number; value: number };
  lost: number;
  /** Won ÷ (won + lost) closed in the window; null with nothing closed. */
  win_rate: number | null;
  by_agent: Array<{ agent_id: string; agent_name: string; open: number; open_value: number; won: number; won_value: number }>;
  lost_reasons: Array<{ reason: string; count: number }>;
  /** Leads opened in the window, by first-touch source ('direct' = none). */
  by_source: Array<{ source: string; leads: number; on_board: number; won: number; won_value: number }>;
}

/** Dashboard numbers for the whole business: open deals now, and what closed in the last `days`. */
export async function loadPipelineSummary(businessId: string, days = 30): Promise<PipelineSummary> {
  const span = Math.min(Math.max(Math.floor(days), 1), 365);
  const stages = await ensureStages(businessId);
  const from = `FROM leads l
      JOIN whatsapp_pipeline_stages s ON s.id = l.stage_id AND s.business_id = l.business_id`;
  const scope = `WHERE l.business_id = $1`;
  const base = `${from} ${scope}`;
  const closedIn = `l.stage_changed_at >= NOW() - ($2::int * INTERVAL '1 day')`;

  const [perStage, agents, reasons, sources] = await Promise.all([
    queryRows<{ stage_id: string; count: number; total_value: number }>(
      `SELECT l.stage_id::text AS stage_id, COUNT(*)::int AS count, COALESCE(SUM(l.deal_value), 0)::float8 AS total_value
       ${base} AND (s.kind = 'open' OR ${closedIn})
       GROUP BY l.stage_id`,
      [businessId, span],
    ),
    queryRows<PipelineSummary['by_agent'][number]>(
      `SELECT u.id::text AS agent_id, u.name AS agent_name,
              COUNT(*) FILTER (WHERE s.kind = 'open')::int AS open,
              COALESCE(SUM(l.deal_value) FILTER (WHERE s.kind = 'open'), 0)::float8 AS open_value,
              COUNT(*) FILTER (WHERE s.kind = 'won' AND ${closedIn})::int AS won,
              COALESCE(SUM(l.deal_value) FILTER (WHERE s.kind = 'won' AND ${closedIn}), 0)::float8 AS won_value
       ${from}
       JOIN users u ON u.id = l.owner_id
       ${scope}
       GROUP BY u.id, u.name
       HAVING COUNT(*) FILTER (WHERE s.kind = 'open' OR ${closedIn}) > 0
       ORDER BY won_value DESC, open_value DESC, u.name
       LIMIT 20`,
      [businessId, span],
    ),
    queryRows<{ reason: string; count: number }>(
      `SELECT lower(trim(l.lost_reason)) AS reason, COUNT(*)::int AS count
       ${base} AND s.kind = 'lost' AND ${closedIn} AND NULLIF(trim(l.lost_reason), '') IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      [businessId, span],
    ),
    queryRows<PipelineSummary['by_source'][number]>(
      `SELECT COALESCE(l.source, 'direct') AS source, COUNT(*)::int AS leads,
              COUNT(l.stage_id)::int AS on_board,
              COUNT(*) FILTER (WHERE s.kind = 'won')::int AS won,
              COALESCE(SUM(l.deal_value) FILTER (WHERE s.kind = 'won'), 0)::float8 AS won_value
         FROM leads l
         LEFT JOIN whatsapp_pipeline_stages s ON s.id = l.stage_id AND s.business_id = l.business_id
        WHERE l.business_id = $1
          AND l.opened_at >= NOW() - ($2::int * INTERVAL '1 day')
        GROUP BY 1
        ORDER BY leads DESC`,
      [businessId, span],
    ),
  ]);

  const withTotals = stages.map((s) => {
    const t = perStage.find((x) => x.stage_id === s.id);
    return { ...s, count: t?.count ?? 0, total_value: t?.total_value ?? 0 };
  });
  const won = withTotals.filter((s) => s.kind === 'won');
  const wonCount = won.reduce((n, s) => n + s.count, 0);
  const lost = withTotals.filter((s) => s.kind === 'lost').reduce((n, s) => n + s.count, 0);
  return {
    stages: withTotals,
    days: span,
    won: { count: wonCount, value: won.reduce((n, s) => n + s.total_value, 0) },
    lost,
    win_rate: wonCount + lost > 0 ? wonCount / (wonCount + lost) : null,
    by_agent: agents,
    lost_reasons: reasons,
    by_source: sources,
  };
}
