/**
 * Connect sales pipeline: per-business stages and the deal on each chat (stage, value, close date).
 * A chat joins the board the first time it gets a stage. Business identity always comes from the session.
 */
import { query, queryOne, queryRows } from '@/lib/db';
import { broadcastOwnership, visibilityClause, type InboxViewer } from '@/lib/whatsapp/inbox-ownership';

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

/** Who moved the deal; shown in the chat timeline. */
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

/** Deletes a stage after moving its chats to `moveToId` (or off the board when null). */
export async function deleteStage(businessId: string, stageId: string, moveToId: string | null): Promise<void> {
  const stages = await listStages(businessId);
  if (!stages.some((s) => s.id === stageId)) throw new PipelineError('Stage not found', 404, 'NOT_FOUND');
  if (stages.length <= 1) throw new PipelineError('Keep at least one stage', 400, 'LAST_STAGE');
  if (moveToId && (moveToId === stageId || !stages.some((s) => s.id === moveToId))) {
    throw new PipelineError('Pick another stage to move these chats to', 400, 'BAD_TARGET');
  }
  await query(
    `UPDATE whatsapp_conversations SET stage_id = $3::uuid, stage_changed_at = NOW()
      WHERE business_id = $1 AND stage_id = $2::uuid`,
    [businessId, stageId, moveToId],
  );
  await query(`DELETE FROM whatsapp_pipeline_stages WHERE id = $1::uuid AND business_id = $2`, [stageId, businessId]);
}

function legacyStatusFor(stage: PipelineStage): LegacyLeadStatus {
  if (stage.legacy_key) return stage.legacy_key;
  if (stage.kind === 'won') return 'converted';
  if (stage.kind === 'lost') return 'lost';
  return 'interested';
}

function parseDealValue(raw: number | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999_999) throw new PipelineError('Enter a deal value of 0 or more', 400, 'BAD_VALUE');
  return Math.round(n * 100) / 100;
}

function parseCloseDate(raw: string | null): string | null {
  if (raw === null || raw === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new PipelineError('Expected close date must look like 2026-11-30', 400, 'BAD_DATE');
  }
  return raw;
}

export async function loadDeal(businessId: string, conversationId: string): Promise<DealView | null> {
  return queryOne<DealView>(
    `SELECT stage_id::text AS stage_id, deal_value::float8 AS deal_value,
            to_char(expected_close_on, 'YYYY-MM-DD') AS expected_close_on, lost_reason, stage_changed_at,
            source, source_detail
       FROM whatsapp_conversations WHERE id = $1::uuid AND business_id = $2`,
    [conversationId, businessId],
  );
}

/**
 * Updates the deal on one chat. The caller has already checked the chat is visible to the actor.
 * A stage change also writes the old lead_status, records a timeline event and refreshes open inboxes.
 */
export async function setDeal(
  businessId: string,
  conversationId: string,
  patch: DealPatch,
  actor: DealActor,
): Promise<DealView> {
  const current = await queryOne<{ stage_id: string | null; is_group: boolean | null }>(
    `SELECT stage_id::text AS stage_id, is_group FROM whatsapp_conversations WHERE id = $1::uuid AND business_id = $2`,
    [conversationId, businessId],
  );
  if (!current) throw new PipelineError('Conversation not found', 404, 'NOT_FOUND');
  if (current.is_group) throw new PipelineError('Group chats cannot go on the pipeline', 400, 'GROUP_CHAT');

  const sets: string[] = [];
  const values: unknown[] = [conversationId, businessId];
  const set = (col: string, v: unknown, cast = '') => {
    values.push(v);
    sets.push(`${col} = $${values.length}${cast}`);
  };

  let fromStage: PipelineStage | null = null;
  let toStage: PipelineStage | null = null;
  const stageChanges = patch.stageId !== undefined && (patch.stageId || null) !== current.stage_id;
  if (stageChanges) {
    const stages = await ensureStages(businessId);
    fromStage = stages.find((s) => s.id === current.stage_id) ?? null;
    if (patch.stageId) {
      toStage = stages.find((s) => s.id === patch.stageId) ?? null;
      if (!toStage) throw new PipelineError('Stage not found', 404, 'STAGE_NOT_FOUND');
      set('lead_status', legacyStatusFor(toStage));
    }
    set('stage_id', toStage?.id ?? null, '::uuid');
    sets.push('stage_changed_at = NOW()');
    // Moving out of a lost stage clears the reason unless a new one is sent.
    if (toStage?.kind !== 'lost' && patch.lostReason === undefined) sets.push('lost_reason = NULL');
  }
  if (patch.dealValue !== undefined) set('deal_value', parseDealValue(patch.dealValue));
  if (patch.expectedCloseOn !== undefined) set('expected_close_on', parseCloseDate(patch.expectedCloseOn), '::date');
  if (patch.lostReason !== undefined) {
    const reason = typeof patch.lostReason === 'string' ? patch.lostReason.trim().slice(0, 200) : '';
    set('lost_reason', reason || null);
  }

  if (sets.length) {
    await query(
      `UPDATE whatsapp_conversations SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::uuid AND business_id = $2`,
      values,
    );
  }

  if (stageChanges) {
    const actorName =
      actor.source === 'agent'
        ? (await queryOne<{ name: string | null }>('SELECT name FROM users WHERE id = $1::uuid', [actor.userId]).catch(() => null))?.name ?? null
        : null;
    await query(
      `INSERT INTO whatsapp_automation_events (conversation_id, business_id, event_type, event_data)
       VALUES ($1, $2, 'stage_changed', $3::jsonb)`,
      [
        conversationId,
        businessId,
        JSON.stringify({
          from_stage: fromStage?.name ?? null,
          to_stage: toStage?.name ?? null,
          source: actor.source,
          actor_name: actorName,
        }),
      ],
    ).catch((err) => console.warn('[pipeline] timeline event failed:', err instanceof Error ? err.message : err));
    await broadcastOwnership(businessId, conversationId);
  }

  return (await loadDeal(businessId, conversationId))!;
}

/** Moves a chat to the stage that replaced an old lead_status value (AI agent "when qualified"). */
export async function setStageByLegacyKey(
  businessId: string,
  conversationId: string,
  key: LegacyLeadStatus,
  actor: DealActor,
): Promise<void> {
  const stages = await ensureStages(businessId);
  const stage =
    stages.find((s) => s.legacy_key === key) ??
    (key === 'converted' ? stages.find((s) => s.kind === 'won') : key === 'lost' ? stages.find((s) => s.kind === 'lost') : stages.find((s) => s.kind === 'open'));
  if (!stage) return;
  await setDeal(businessId, conversationId, { stageId: stage.id }, actor);
}

export interface BoardCard {
  id: string;
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
  /** The number is already one of the business's customers. */
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
  /** A lead source key, or 'direct' for chats with none. */
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
  const where: string[] = [
    'c.business_id = $1',
    'c.stage_id IS NOT NULL',
    'NOT COALESCE(c.is_group, false)',
    `COALESCE(c.status, 'active') <> 'blocked'`,
  ];
  const vis = visibilityClause(viewer, 'c', params.length + 1);
  where.push(vis.sql);
  params.push(...vis.params);

  if (filters.ownerId && UUID_RE.test(filters.ownerId)) {
    params.push(filters.ownerId);
    where.push(`(c.inbox_state = 'intervened' AND c.assigned_to = $${params.length}::uuid)`);
  }
  if (filters.source === 'direct') {
    where.push('c.source IS NULL');
  } else if (filters.source && /^[a-z_]{2,16}$/.test(filters.source)) {
    params.push(filters.source);
    where.push(`c.source = $${params.length}`);
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
    where.push(`(c.whatsapp_display_name ILIKE ${p} OR c.from_number ILIKE ${p} OR cust.name ILIKE ${p})`);
  }
  const closedDays = Math.min(Math.max(Math.floor(filters.closedDays ?? 90), 1), 3650);
  params.push(closedDays);
  where.push(`(s.kind = 'open' OR c.stage_changed_at >= NOW() - ($${params.length}::int * INTERVAL '1 day'))`);

  const base = `
      FROM whatsapp_conversations c
      JOIN whatsapp_pipeline_stages s ON s.id = c.stage_id AND s.business_id = c.business_id
      LEFT JOIN customers cust ON cust.id = c.customer_id AND cust.business_id = c.business_id
      LEFT JOIN users u ON u.id = c.assigned_to
      LEFT JOIN whatsapp_lead_profiles lp ON lp.conversation_id = c.id AND lp.business_id = c.business_id
     WHERE ${where.join(' AND ')}`;

  const totals = await queryRows<{ stage_id: string; count: number; total_value: number }>(
    `SELECT c.stage_id::text AS stage_id, COUNT(*)::int AS count, COALESCE(SUM(c.deal_value), 0)::float8 AS total_value
     ${base}
     GROUP BY c.stage_id`,
    params,
  );

  const cardParams = [...params];
  let stageFilter = '';
  if (filters.stageId && UUID_RE.test(filters.stageId)) {
    cardParams.push(filters.stageId);
    stageFilter = `AND c.stage_id = $${cardParams.length}::uuid`;
  }
  const offset = Math.max(Math.floor(filters.offset ?? 0), 0);
  cardParams.push(offset, BOARD_CARDS_PER_STAGE);
  const pOffset = `$${cardParams.length - 1}`;
  const pLimit = `$${cardParams.length}`;

  const cards = await queryRows<BoardCard>(
    `SELECT * FROM (
       SELECT c.id::text AS id, c.stage_id::text AS stage_id,
              COALESCE(NULLIF(cust.name, ''), NULLIF(c.whatsapp_display_name, ''), c.from_number) AS name,
              c.from_number AS phone, c.profile_picture_url, c.last_message_text, c.last_message_at,
              c.deal_value::float8 AS deal_value, to_char(c.expected_close_on, 'YYYY-MM-DD') AS expected_close_on,
              c.stage_changed_at,
              CASE WHEN c.inbox_state = 'intervened' THEN c.assigned_to::text END AS owner_id,
              CASE WHEN c.inbox_state = 'intervened' THEN u.name END AS owner_name,
              lp.lead_status AS temperature, lp.lead_score, NULLIF(lp.ai_summary, '') AS summary,
              (c.customer_id IS NOT NULL) AS is_customer, c.source,
              (SELECT MIN(f.due_at) FROM whatsapp_followups f WHERE f.conversation_id = c.id AND f.status = 'pending') AS next_followup_at,
              ROW_NUMBER() OVER (PARTITION BY c.stage_id ORDER BY c.stage_changed_at DESC NULLS LAST, c.id) AS rn
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
  /** Chats that started in the window, by first-touch source ('direct' = none). */
  by_source: Array<{ source: string; leads: number; on_board: number; won: number; won_value: number }>;
}

/** Dashboard numbers for the whole business: open deals now, and what closed in the last `days`. */
export async function loadPipelineSummary(businessId: string, days = 30): Promise<PipelineSummary> {
  const span = Math.min(Math.max(Math.floor(days), 1), 365);
  const stages = await ensureStages(businessId);
  const from = `FROM whatsapp_conversations c
      JOIN whatsapp_pipeline_stages s ON s.id = c.stage_id AND s.business_id = c.business_id`;
  const scope = `WHERE c.business_id = $1 AND NOT COALESCE(c.is_group, false)`;
  const base = `${from} ${scope}`;
  const closedIn = `c.stage_changed_at >= NOW() - ($2::int * INTERVAL '1 day')`;

  const [perStage, agents, reasons, sources] = await Promise.all([
    queryRows<{ stage_id: string; count: number; total_value: number }>(
      `SELECT c.stage_id::text AS stage_id, COUNT(*)::int AS count, COALESCE(SUM(c.deal_value), 0)::float8 AS total_value
       ${base} AND (s.kind = 'open' OR ${closedIn})
       GROUP BY c.stage_id`,
      [businessId, span],
    ),
    queryRows<PipelineSummary['by_agent'][number]>(
      `SELECT u.id::text AS agent_id, u.name AS agent_name,
              COUNT(*) FILTER (WHERE s.kind = 'open')::int AS open,
              COALESCE(SUM(c.deal_value) FILTER (WHERE s.kind = 'open'), 0)::float8 AS open_value,
              COUNT(*) FILTER (WHERE s.kind = 'won' AND ${closedIn})::int AS won,
              COALESCE(SUM(c.deal_value) FILTER (WHERE s.kind = 'won' AND ${closedIn}), 0)::float8 AS won_value
       ${from}
       JOIN users u ON u.id = c.assigned_to
       ${scope}
       GROUP BY u.id, u.name
       HAVING COUNT(*) FILTER (WHERE s.kind = 'open' OR ${closedIn}) > 0
       ORDER BY won_value DESC, open_value DESC, u.name
       LIMIT 20`,
      [businessId, span],
    ),
    queryRows<{ reason: string; count: number }>(
      `SELECT lower(trim(c.lost_reason)) AS reason, COUNT(*)::int AS count
       ${base} AND s.kind = 'lost' AND ${closedIn} AND NULLIF(trim(c.lost_reason), '') IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      [businessId, span],
    ),
    queryRows<PipelineSummary['by_source'][number]>(
      `SELECT COALESCE(c.source, 'direct') AS source, COUNT(*)::int AS leads,
              COUNT(c.stage_id)::int AS on_board,
              COUNT(*) FILTER (WHERE s.kind = 'won')::int AS won,
              COALESCE(SUM(c.deal_value) FILTER (WHERE s.kind = 'won'), 0)::float8 AS won_value
         FROM whatsapp_conversations c
         LEFT JOIN whatsapp_pipeline_stages s ON s.id = c.stage_id AND s.business_id = c.business_id
        WHERE c.business_id = $1 AND NOT COALESCE(c.is_group, false)
          AND COALESCE(c.source_at, c.created_at) >= NOW() - ($2::int * INTERVAL '1 day')
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
