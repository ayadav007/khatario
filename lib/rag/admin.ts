import { z } from 'zod';
import { queryOne, queryRows } from '@/lib/db';
import { chatModelConfigured, ragConfig } from './config';
import { getPlatformAssistantSettings, tokensUsedToday } from './settings';
import { hasVectorColumn } from './vector-support';
import { CHANNELS } from './types';

export const ADMIN_VIEWS = ['overview', 'conversations', 'leads', 'unanswered', 'feedback', 'sources'] as const;
export type AdminView = (typeof ADMIN_VIEWS)[number];

export const LEAD_STATUSES = ['new', 'contacted', 'demo_booked', 'trial_started', 'converted', 'lost'] as const;

export const LeadUpdateSchema = z
  .object({
    status: z.enum(LEAD_STATUSES).optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine((v) => v.status !== undefined || v.notes !== undefined, { message: 'Nothing to update' });

export const SettingsUpdateSchema = z.object({
  channels: z.record(z.enum(CHANNELS), z.boolean()),
});

export const ReindexSchema = z.object({
  target: z.enum(['markdown', 'plans', 'marketing', 'all']).default('all'),
  force: z.boolean().optional(),
});

const PAGE_SIZE = 25;

function page(raw: string | null): number {
  const n = parseInt(raw ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1;
}

export async function getOverview() {
  const cfg = ragConfig();
  const [stats, settings, used, vector] = await Promise.all([
    queryOne<{
      conversations_7d: string;
      messages_7d: string;
      unanswered_7d: string;
      handed_off_7d: string;
      new_leads: string;
      thumbs_up_7d: string;
      thumbs_down_7d: string;
      sources_error: string;
      last_indexed_at: string | null;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM kb_conversations WHERE created_at > NOW() - INTERVAL '7 days') AS conversations_7d,
         (SELECT COUNT(*) FROM kb_messages WHERE role = 'user' AND created_at > NOW() - INTERVAL '7 days') AS messages_7d,
         (SELECT COUNT(*) FROM kb_messages WHERE role = 'assistant' AND answered = false AND created_at > NOW() - INTERVAL '7 days') AS unanswered_7d,
         (SELECT COUNT(*) FROM kb_conversations WHERE status = 'handed_off' AND created_at > NOW() - INTERVAL '7 days') AS handed_off_7d,
         (SELECT COUNT(*) FROM assistant_leads WHERE status = 'new') AS new_leads,
         (SELECT COUNT(*) FROM kb_feedback WHERE rating = 1 AND created_at > NOW() - INTERVAL '7 days') AS thumbs_up_7d,
         (SELECT COUNT(*) FROM kb_feedback WHERE rating = -1 AND created_at > NOW() - INTERVAL '7 days') AS thumbs_down_7d,
         (SELECT COUNT(*) FROM kb_sources WHERE status = 'error') AS sources_error,
         (SELECT MAX(last_indexed_at) FROM kb_sources) AS last_indexed_at`,
    ),
    getPlatformAssistantSettings(),
    tokensUsedToday(),
    hasVectorColumn(),
  ]);
  const n = (v: string | undefined) => Number(v ?? 0);
  return {
    stats: {
      conversations7d: n(stats?.conversations_7d),
      messages7d: n(stats?.messages_7d),
      unanswered7d: n(stats?.unanswered_7d),
      handedOff7d: n(stats?.handed_off_7d),
      newLeads: n(stats?.new_leads),
      thumbsUp7d: n(stats?.thumbs_up_7d),
      thumbsDown7d: n(stats?.thumbs_down_7d),
      sourcesWithErrors: n(stats?.sources_error),
      lastIndexedAt: stats?.last_indexed_at ?? null,
    },
    health: {
      enabled: cfg.enabled,
      chatModel: chatModelConfigured(cfg),
      embeddings: Boolean(cfg.geminiKey),
      vector,
      tokensToday: used,
      dailyTokenBudget: cfg.dailyTokenBudget,
      retentionDays: cfg.retentionDays,
    },
    settings,
  };
}

export async function listConversations(params: URLSearchParams) {
  const p = page(params.get('page'));
  const channel = params.get('channel');
  const status = params.get('status');
  const rows = await queryRows(
    `SELECT c.id, c.channel, c.audience, c.status, c.message_count, c.last_message_at, c.created_at,
            c.page_path, b.name AS business_name, l.name AS lead_name, l.phone AS lead_phone,
            (SELECT m.content FROM kb_messages m WHERE m.conversation_id = c.id AND m.role = 'user'
              ORDER BY m.created_at ASC LIMIT 1) AS first_question
       FROM kb_conversations c
       LEFT JOIN businesses b ON b.id = c.business_id
       LEFT JOIN assistant_leads l ON l.id = c.lead_id
      WHERE ($1::text IS NULL OR c.channel = $1)
        AND ($2::text IS NULL OR c.status = $2)
      ORDER BY c.last_message_at DESC
      LIMIT ${PAGE_SIZE} OFFSET $3`,
    [channel || null, status || null, (p - 1) * PAGE_SIZE],
  );
  return { rows, page: p, pageSize: PAGE_SIZE };
}

export async function getConversation(id: string) {
  const conversation = await queryOne(
    `SELECT c.*, b.name AS business_name FROM kb_conversations c
       LEFT JOIN businesses b ON b.id = c.business_id WHERE c.id = $1`,
    [id],
  );
  if (!conversation) return null;
  const messages = await queryRows(
    `SELECT m.id, m.role, m.content, m.intent, m.action, m.model, m.answered, m.tokens_in, m.tokens_out,
            m.latency_ms, m.retrieval, m.created_at, f.rating AS feedback
       FROM kb_messages m
       LEFT JOIN kb_feedback f ON f.message_id = m.id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC`,
    [id],
  );
  return { conversation, messages };
}

export async function listLeads(params: URLSearchParams) {
  const p = page(params.get('page'));
  const status = params.get('status');
  const rows = await queryRows(
    `SELECT l.*, d.booking_number, d.scheduled_date, d.scheduled_time
       FROM assistant_leads l
       LEFT JOIN demo_bookings d ON d.id = l.booking_id
      WHERE ($1::text IS NULL OR l.status = $1)
      ORDER BY l.created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET $2`,
    [status || null, (p - 1) * PAGE_SIZE],
  );
  return { rows, page: p, pageSize: PAGE_SIZE };
}

export async function updateLead(id: string, update: z.infer<typeof LeadUpdateSchema>) {
  return queryOne(
    `UPDATE assistant_leads
        SET status = COALESCE($2, status), notes = COALESCE($3, notes), updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, update.status ?? null, update.notes ?? null],
  );
}

/** Unanswered assistant turns paired with the user question that triggered them. */
export async function listUnanswered(params: URLSearchParams) {
  const p = page(params.get('page'));
  const rows = await queryRows(
    `SELECT a.id, a.conversation_id, a.created_at, a.retrieval, c.channel, c.audience,
            (SELECT u.content FROM kb_messages u
              WHERE u.conversation_id = a.conversation_id AND u.role = 'user' AND u.created_at <= a.created_at
              ORDER BY u.created_at DESC LIMIT 1) AS question
       FROM kb_messages a
       JOIN kb_conversations c ON c.id = a.conversation_id
      WHERE a.role = 'assistant' AND a.answered = false
      ORDER BY a.created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET $1`,
    [(p - 1) * PAGE_SIZE],
  );
  return { rows, page: p, pageSize: PAGE_SIZE };
}

export async function listFeedback(params: URLSearchParams) {
  const p = page(params.get('page'));
  const rating = params.get('rating') === 'up' ? 1 : params.get('rating') === 'down' ? -1 : null;
  const rows = await queryRows(
    `SELECT f.id, f.rating, f.comment, f.created_at, m.id AS message_id, m.content AS answer,
            m.conversation_id, c.channel,
            (SELECT u.content FROM kb_messages u
              WHERE u.conversation_id = m.conversation_id AND u.role = 'user' AND u.created_at <= m.created_at
              ORDER BY u.created_at DESC LIMIT 1) AS question
       FROM kb_feedback f
       JOIN kb_messages m ON m.id = f.message_id
       JOIN kb_conversations c ON c.id = m.conversation_id
      WHERE ($1::smallint IS NULL OR f.rating = $1)
      ORDER BY f.created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET $2`,
    [rating, (p - 1) * PAGE_SIZE],
  );
  return { rows, page: p, pageSize: PAGE_SIZE };
}

export async function listSources() {
  const rows = await queryRows(
    `SELECT s.id, s.kind, s.locator, s.audiences, s.status, s.error, s.chunk_count, s.last_indexed_at,
            (SELECT COUNT(*) FROM kb_documents d WHERE d.source_id = s.id AND d.is_active) AS documents
       FROM kb_sources s
      WHERE s.business_id IS NULL AND s.status <> 'deleted'
      ORDER BY s.kind, s.locator`,
  );
  return { rows };
}

export async function loadAdminView(view: AdminView, params: URLSearchParams) {
  switch (view) {
    case 'overview':
      return getOverview();
    case 'conversations':
      return listConversations(params);
    case 'leads':
      return listLeads(params);
    case 'unanswered':
      return listUnanswered(params);
    case 'feedback':
      return listFeedback(params);
    case 'sources':
      return listSources();
  }
}
