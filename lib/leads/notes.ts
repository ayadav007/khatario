/**
 * Lead comments: internal notes (whatsapp_conversation_notes, migration 452) that belong to an enquiry.
 * A note written on a chat files under the chat's open lead; a note written on a lead stays with it, and its chat
 * (now or once one links) shows it. Only the author or a supervisor deletes a note. Business identity always
 * comes from the viewer (the session).
 */
import { query, queryOne, queryRows } from '@/lib/db';
import { canViewConversation, type InboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { openLeadForChat } from './chat-deal';
import { loadLead } from './core';
import { canViewLead } from './visibility';

export const NOTE_MAX = 4000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class NoteError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface NoteRow {
  id: string;
  note_text: string;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  /** The enquiry the note belongs to, for the "Enquiry of 12 Oct · Won" tag. */
  lead_opened_at: string | null;
  lead_closed_at: string | null;
  lead_stage_name: string | null;
  lead_stage_kind: 'open' | 'won' | 'lost' | null;
}

const NOTE_SELECT = `
  SELECT n.id::text AS id, n.note_text, n.created_at, n.user_id::text AS user_id,
         u.name AS user_name, u.email AS user_email,
         n.lead_id::text AS lead_id, n.conversation_id::text AS conversation_id,
         l.opened_at AS lead_opened_at, l.closed_at AS lead_closed_at,
         s.name AS lead_stage_name, s.kind AS lead_stage_kind
    FROM whatsapp_conversation_notes n
    LEFT JOIN users u ON u.id = n.user_id
    LEFT JOIN leads l ON l.id = n.lead_id AND l.business_id = n.business_id
    LEFT JOIN whatsapp_pipeline_stages s ON s.id = l.stage_id`;

function cleanText(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new NoteError('Write a note first', 400, 'NOTE_REQUIRED');
  if (text.length > NOTE_MAX) throw new NoteError(`Keep notes under ${NOTE_MAX} characters`, 400, 'NOTE_TOO_LONG');
  return text;
}

async function loadNote(businessId: string, noteId: string): Promise<NoteRow | null> {
  return queryOne<NoteRow>(`${NOTE_SELECT} WHERE n.id = $1::uuid AND n.business_id = $2`, [noteId, businessId]);
}

async function insertNote(
  viewer: InboxViewer,
  fields: { conversationId: string | null; leadId: string | null },
  text: string,
): Promise<NoteRow> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO whatsapp_conversation_notes (conversation_id, lead_id, business_id, user_id, note_text)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5)
     RETURNING id::text AS id`,
    [fields.conversationId, fields.leadId, viewer.businessId, viewer.userId, text],
  );
  return (await loadNote(viewer.businessId, row!.id))!;
}

/** Every note on a chat: its own notes and those of any lead linked to it, newest first. */
export async function listChatNotes(viewer: InboxViewer, conversationId: string): Promise<NoteRow[]> {
  if (!UUID_RE.test(conversationId) || !(await canViewConversation(viewer, conversationId))) {
    throw new NoteError('Conversation not found', 404, 'NOT_FOUND');
  }
  return queryRows<NoteRow>(
    `${NOTE_SELECT}
      WHERE n.business_id = $1
        AND (n.conversation_id = $2::uuid
             OR n.lead_id IN (SELECT id FROM leads WHERE business_id = $1 AND conversation_id = $2::uuid))
      ORDER BY n.created_at DESC, n.id DESC`,
    [viewer.businessId, conversationId],
  );
}

/** A note written on a chat: filed under the chat's open lead, else a general chat note. */
export async function addChatNote(viewer: InboxViewer, conversationId: string, rawText: unknown): Promise<NoteRow> {
  const text = cleanText(rawText);
  if (!UUID_RE.test(conversationId) || !(await canViewConversation(viewer, conversationId))) {
    throw new NoteError('Conversation not found', 404, 'NOT_FOUND');
  }
  const lead = await openLeadForChat(viewer.businessId, conversationId, 'this_chat');
  return insertNote(viewer, { conversationId, leadId: lead?.id ?? null }, text);
}

/** A lead's notes, newest first; null when the viewer cannot see the lead. */
export async function listLeadNotes(viewer: InboxViewer, leadId: string): Promise<NoteRow[] | null> {
  if (!(await canViewLead(viewer, leadId))) return null;
  return queryRows<NoteRow>(
    `${NOTE_SELECT} WHERE n.business_id = $1 AND n.lead_id = $2::uuid ORDER BY n.created_at DESC, n.id DESC`,
    [viewer.businessId, leadId],
  );
}

/** A note written on a lead: kept on the lead and on its chat when it has one. */
export async function addLeadNote(viewer: InboxViewer, leadId: string, rawText: unknown): Promise<NoteRow> {
  const text = cleanText(rawText);
  if (!(await canViewLead(viewer, leadId))) throw new NoteError('Lead not found', 404, 'NOT_FOUND');
  const lead = await loadLead(viewer.businessId, leadId);
  if (!lead) throw new NoteError('Lead not found', 404, 'NOT_FOUND');
  return insertNote(viewer, { conversationId: lead.conversation_id, leadId: lead.id }, text);
}

/** Deletes a note the viewer can see; only its author or a supervisor may. */
export async function deleteNote(viewer: InboxViewer, noteId: string): Promise<void> {
  const note = UUID_RE.test(noteId) ? await loadNote(viewer.businessId, noteId) : null;
  const visible =
    note &&
    (note.lead_id
      ? await canViewLead(viewer, note.lead_id)
      : !!note.conversation_id && (await canViewConversation(viewer, note.conversation_id)));
  if (!note || !visible) throw new NoteError('Note not found', 404, 'NOT_FOUND');
  if (note.user_id !== viewer.userId && !viewer.isSupervisor) {
    throw new NoteError('Only the person who wrote a note, or a manager, can delete it', 403, 'NOT_AUTHOR');
  }
  await query(`DELETE FROM whatsapp_conversation_notes WHERE id = $1::uuid AND business_id = $2`, [noteId, viewer.businessId]);
}
