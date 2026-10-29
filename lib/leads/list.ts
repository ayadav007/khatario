/**
 * Connect leads: the Leads page. Filtered list, one lead's detail, manual add, "new enquiry" from a
 * closed or open lead, and the CSV export. Every read goes through leadVisibilityClause, so an agent
 * only gets leads they could open; business and user always come from the viewer (the session).
 */
import { query, queryOne, queryRows } from '@/lib/db';
import { csvSafeText } from '@/lib/csv-safe';
import type { InboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { listFollowups, type FollowupRow } from '@/lib/whatsapp/followups';
import { ensureStages } from '@/lib/whatsapp/pipeline';
import { LeadError, findOpenLead, loadLead, openLead, setLeadStage, type Lead, type LeadSourceKey } from './core';
import { canViewLead, leadVisibilityClause } from './visibility';

export const LEADS_PAGE_SIZE = 50;
export const LEADS_EXPORT_CAP = 5000;
export const NEW_ENQUIRY_REASON = 'New enquiry';

export interface LeadFilters {
  leadType?: 'new' | 'existing';
  stageId?: string;
  /** A lead source key, or 'direct' for leads with none. */
  source?: string;
  ownerId?: string;
  /** YYYY-MM-DD, inclusive. */
  openedFrom?: string;
  openedTo?: string;
  search?: string;
  /** Default 'all'. */
  status?: 'open' | 'closed' | 'all';
  offset?: number;
}

export interface LeadRow {
  id: string;
  name: string;
  phone: string;
  conversation_id: string | null;
  /** Messages in the linked chat; null without a chat. Counted for the page's rows only. */
  message_count: number | null;
  lead_type: 'new' | 'existing';
  source: string | null;
  stage_id: string | null;
  stage_name: string | null;
  stage_kind: 'open' | 'won' | 'lost' | null;
  /** The linked chat's AI temperature and score, as on the board. */
  temperature: string | null;
  lead_score: number | null;
  owner_id: string | null;
  owner_name: string | null;
  customer_id: string | null;
  opened_at: string;
  last_activity_at: string;
  closed_at: string | null;
}

export interface LeadDetail extends LeadRow {
  deal_value: number | null;
  expected_close_on: string | null;
  lost_reason: string | null;
  note: string | null;
  source_detail: Record<string, unknown> | null;
  summary: string | null;
  followups: FollowupRow[];
  /** Other enquiries from the same number (earlier or later), newest first. */
  other_leads: Array<{ id: string; opened_at: string; closed_at: string | null; stage_name: string | null }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FROM_SQL = `
  FROM leads l
  LEFT JOIN whatsapp_pipeline_stages s ON s.id = l.stage_id AND s.business_id = l.business_id
  LEFT JOIN whatsapp_conversations c ON c.id = l.conversation_id AND c.business_id = l.business_id
  LEFT JOIN customers cust ON cust.id = l.customer_id AND cust.business_id = l.business_id
  LEFT JOIN users u ON u.id = l.owner_id
  LEFT JOIN whatsapp_lead_profiles lp ON lp.conversation_id = c.id AND lp.business_id = l.business_id`;

const ROW_COLUMNS = `l.id::text AS id,
  COALESCE(NULLIF(cust.name, ''), NULLIF(l.contact_name, ''), NULLIF(c.whatsapp_display_name, ''), l.contact_phone) AS name,
  l.contact_phone AS phone, l.conversation_id::text AS conversation_id, l.lead_type, l.source,
  l.stage_id::text AS stage_id, s.name AS stage_name, s.kind AS stage_kind,
  lp.lead_status AS temperature, lp.lead_score, l.owner_id::text AS owner_id, u.name AS owner_name,
  l.customer_id::text AS customer_id, l.opened_at, l.last_activity_at, l.closed_at`;

const messageCountSql = (conversationId: string) =>
  `CASE WHEN ${conversationId} IS NULL THEN NULL
        ELSE (SELECT COUNT(*)::int FROM whatsapp_conversation_messages m WHERE m.conversation_id = ${conversationId}::uuid) END`;

function validDate(raw: string | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : null;
}

/** The WHERE clause for a filtered, visibility-checked list. Bad filter values are ignored, as on the board. */
function listWhere(viewer: InboxViewer, filters: LeadFilters, params: unknown[]): string {
  const where: string[] = ['l.business_id = $1'];
  const vis = leadVisibilityClause(viewer, 'l', 'c', params.length + 1);
  where.push(vis.sql);
  params.push(...vis.params);

  if (filters.leadType === 'new' || filters.leadType === 'existing') {
    params.push(filters.leadType);
    where.push(`l.lead_type = $${params.length}`);
  }
  if (filters.stageId && UUID_RE.test(filters.stageId)) {
    params.push(filters.stageId);
    where.push(`l.stage_id = $${params.length}::uuid`);
  }
  if (filters.source === 'direct') {
    where.push('l.source IS NULL');
  } else if (filters.source && /^[a-z_]{2,16}$/.test(filters.source)) {
    params.push(filters.source);
    where.push(`l.source = $${params.length}`);
  }
  if (filters.ownerId && UUID_RE.test(filters.ownerId)) {
    params.push(filters.ownerId);
    where.push(`l.owner_id = $${params.length}::uuid`);
  }
  const from = validDate(filters.openedFrom);
  if (from) {
    params.push(from);
    where.push(`l.opened_at >= $${params.length}::date`);
  }
  const to = validDate(filters.openedTo);
  if (to) {
    params.push(to);
    where.push(`l.opened_at < ($${params.length}::date + 1)`);
  }
  const search = filters.search?.trim();
  if (search) {
    params.push(`%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    const p = `$${params.length}`;
    where.push(
      `(l.contact_name ILIKE ${p} OR c.whatsapp_display_name ILIKE ${p} OR l.contact_phone ILIKE ${p} OR cust.name ILIKE ${p})`,
    );
  }
  if (filters.status === 'open') where.push('l.closed_at IS NULL');
  else if (filters.status === 'closed') where.push('l.closed_at IS NOT NULL');
  return where.join(' AND ');
}

async function fetchRows(viewer: InboxViewer, filters: LeadFilters, limit: number, offset: number): Promise<LeadRow[]> {
  const params: unknown[] = [viewer.businessId];
  const where = listWhere(viewer, filters, params);
  params.push(limit, offset);
  // The page is cut first so the message count only runs for the rows shown.
  return queryRows<LeadRow>(
    `WITH page AS (
       SELECT ${ROW_COLUMNS}
       ${FROM_SQL}
       WHERE ${where}
       ORDER BY l.opened_at DESC, l.id
       LIMIT $${params.length - 1} OFFSET $${params.length}
     )
     SELECT page.*, ${messageCountSql('page.conversation_id')} AS message_count
       FROM page
      ORDER BY page.opened_at DESC, page.id`,
    params,
  );
}

export async function listLeads(viewer: InboxViewer, filters: LeadFilters): Promise<{ rows: LeadRow[]; total: number }> {
  const offset = Math.max(Math.floor(Number(filters.offset) || 0), 0);
  const countParams: unknown[] = [viewer.businessId];
  const countWhere = listWhere(viewer, filters, countParams);
  const [rows, count] = await Promise.all([
    fetchRows(viewer, filters, LEADS_PAGE_SIZE, offset),
    queryOne<{ total: number }>(`SELECT COUNT(*)::int AS total ${FROM_SQL} WHERE ${countWhere}`, countParams),
  ]);
  return { rows, total: count?.total ?? 0 };
}

/** Filters from a request's query string (type, stage_id, source, owner, from, to, search, status, offset). */
export function parseLeadFilters(sp: URLSearchParams): LeadFilters {
  const get = (k: string) => sp.get(k) || undefined;
  const type = get('type');
  const status = get('status');
  return {
    leadType: type === 'new' || type === 'existing' ? type : undefined,
    stageId: get('stage_id'),
    source: get('source'),
    ownerId: get('owner'),
    openedFrom: get('from'),
    openedTo: get('to'),
    search: get('search'),
    status: status === 'open' || status === 'closed' || status === 'all' ? status : undefined,
    offset: Number(sp.get('offset')) || 0,
  };
}

// ---------------------------------------------------------------- one lead

/** One lead with its deal, reminders and the number's other enquiries; null when the viewer cannot see it. */
export async function loadLeadDetail(viewer: InboxViewer, leadId: string): Promise<LeadDetail | null> {
  if (!UUID_RE.test(leadId)) return null;
  const vis = leadVisibilityClause(viewer, 'l', 'c', 3);
  const base = await queryOne<Omit<LeadDetail, 'followups' | 'other_leads'> & { contact_phone: string }>(
    `SELECT ${ROW_COLUMNS}, ${messageCountSql('l.conversation_id')} AS message_count,
            l.deal_value::float8 AS deal_value, to_char(l.expected_close_on, 'YYYY-MM-DD') AS expected_close_on,
            l.lost_reason, l.note, l.source_detail, NULLIF(lp.ai_summary, '') AS summary
     ${FROM_SQL}
     WHERE l.id = $1::uuid AND l.business_id = $2 AND ${vis.sql}`,
    [leadId, viewer.businessId, ...vis.params],
  );
  if (!base) return null;

  const otherVis = leadVisibilityClause(viewer, 'l', 'c', 4);
  const [followups, others] = await Promise.all([
    listFollowups(viewer, { leadId, when: 'any', all: true, limit: 50 }).then((r) => r.followups),
    queryRows<LeadDetail['other_leads'][number]>(
      `SELECT l.id::text AS id, l.opened_at, l.closed_at, s.name AS stage_name
       ${FROM_SQL}
       WHERE l.business_id = $1 AND l.contact_phone = $2 AND l.id <> $3::uuid AND ${otherVis.sql}
       ORDER BY l.opened_at DESC, l.id
       LIMIT 50`,
      [viewer.businessId, base.phone, leadId, ...otherVis.params],
    ),
  ]);
  return { ...base, followups, other_leads: others };
}

// ---------------------------------------------------------------- adding leads

const MANUAL_SOURCES = ['call', 'walk_in', 'manual'] as const;

const idOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Adds a lead by hand (a call, a walk-in). A phone that already has an open lead returns that lead
 * untouched (existing: true); the form's stage, owner and note are not applied to it.
 */
export async function createManualLead(
  viewer: InboxViewer,
  input: { name: unknown; phone: unknown; source: unknown; note?: unknown; stageId?: unknown; ownerId?: unknown },
): Promise<{ lead: Lead; existing: boolean }> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 120) throw new LeadError('Enter a name of up to 120 characters', 400, 'BAD_NAME');
  if (!(MANUAL_SOURCES as readonly unknown[]).includes(input.source)) {
    throw new LeadError('Source must be call, walk-in or manual', 400, 'BAD_SOURCE');
  }
  const phone = typeof input.phone === 'string' || typeof input.phone === 'number' ? String(input.phone) : '';

  const open = await findOpenLead(viewer.businessId, phone);
  if (open) return { lead: open, existing: true };

  const { lead, created } = await openLead(viewer.businessId, {
    phone,
    name,
    source: input.source as LeadSourceKey,
    note: typeof input.note === 'string' ? input.note : null,
    stageId: idOrNull(input.stageId),
    ownerId: idOrNull(input.ownerId),
    createdBy: viewer.userId,
    actor: { source: 'agent', userId: viewer.userId },
  });
  return { lead, existing: !created };
}

/**
 * A repeat enquiry from the same number. The number's open lead (if any) must be closed first, which
 * needs confirmCloseOpen: it goes to the first lost stage as 'New enquiry'. The new lead copies the
 * phone, name, chat and customer; its source is Direct.
 */
export async function startNewEnquiry(viewer: InboxViewer, leadId: string, confirmCloseOpen: boolean): Promise<Lead> {
  const businessId = viewer.businessId;
  if (!(await canViewLead(viewer, leadId))) throw new LeadError('Lead not found', 404, 'NOT_FOUND');
  const lead = await loadLead(businessId, leadId);
  if (!lead) throw new LeadError('Lead not found', 404, 'NOT_FOUND');
  const actor = { source: 'agent', userId: viewer.userId } as const;

  const open = await findOpenLead(businessId, lead.contact_phone);
  if (open) {
    if (!confirmCloseOpen) throw new LeadError('This number already has an open lead', 409, 'LEAD_OPEN');
    if (!(await canViewLead(viewer, open.id))) {
      throw new LeadError('This number has an open lead you cannot close; ask a supervisor', 403, 'FORBIDDEN');
    }
    const lost = (await ensureStages(businessId)).filter((s) => s.kind === 'lost').sort((a, b) => a.position - b.position)[0];
    if (!lost) throw new LeadError('Add a Lost stage to the pipeline first', 400, 'NO_LOST_STAGE');
    await setLeadStage(businessId, open.id, lost.id, actor, NEW_ENQUIRY_REASON);
  }

  const { lead: fresh, created } = await openLead(businessId, {
    phone: lead.contact_phone,
    name: lead.contact_name,
    conversationId: lead.conversation_id,
    source: null,
    createdBy: viewer.userId,
    actor,
  });
  // Someone opened one for this number between the close and now.
  if (!created) throw new LeadError('This number already has an open lead', 409, 'LEAD_OPEN');
  if (lead.customer_id && !fresh.customer_id) {
    await query(`UPDATE leads SET customer_id = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND business_id = $2`, [
      fresh.id,
      businessId,
      lead.customer_id,
    ]);
    return (await loadLead(businessId, fresh.id))!;
  }
  return fresh;
}

// ---------------------------------------------------------------- export

const SOURCE_LABELS: Record<string, string> = {
  ctwa_ad: 'Ad',
  link: 'Link',
  indiamart: 'IndiaMART',
  lead_api: 'Lead API',
  manual: 'Manual',
  call: 'Call',
  walk_in: 'Walk-in',
};

const CSV_HEADER = ['Name', 'Phone', 'Type', 'Source', 'Stage', 'Owner', 'Opened', 'Last activity', 'Messages'];

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = csvSafeText(String(value));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** India time, like the rest of the app: 2026-10-30 14:05. */
function stamp(value: string | Date | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16);
}

/** RFC 4180 CSV. A cell that would run as a spreadsheet formula is prefixed with an apostrophe. */
export function leadsCsv(rows: LeadRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.phone,
        r.lead_type === 'existing' ? 'Existing' : 'New',
        r.source ? SOURCE_LABELS[r.source] ?? r.source : 'Direct',
        r.stage_name,
        r.owner_name,
        stamp(r.opened_at),
        stamp(r.last_activity_at),
        r.message_count,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n');
}

/** The CSV for the current filters (all pages, up to LEADS_EXPORT_CAP rows), limited to what the viewer can see. */
export async function exportLeads(viewer: InboxViewer, filters: LeadFilters): Promise<string> {
  return leadsCsv(await fetchRows(viewer, filters, LEADS_EXPORT_CAP, 0));
}
