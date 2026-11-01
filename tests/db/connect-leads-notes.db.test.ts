/**
 * Lead comments are chat notes with a lead (migration 452). A note written on a chat files under the chat's open lead;
 * a note written on a lead (even one with no chat) stays with that lead and shows on its chat once one links.
 * Only the author or a supervisor deletes a note; agents only see notes of leads they can see.
 * Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/connect-leads-notes.db.test.ts --runInBand
 * Migrations 447 and 452 must be applied to kh_phase2_test.
 */
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.INBOX_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}

jest.mock('@/lib/services/lead-analyzer', () => ({
  LeadAnalyzer: jest.fn().mockImplementation(() => ({ analyzeLead: jest.fn() })),
}));
jest.mock('@/lib/whatsapp-websocket', () => ({
  emitConversationUpdate: jest.fn(),
  emitNewMessage: jest.fn(),
  emitSummaryUpdate: jest.fn(),
}));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { query, queryOne, closePool } from '@/lib/db';
import { ensureStages } from '@/lib/whatsapp/pipeline';
import { openLead, setLeadStage } from '@/lib/leads/core';
import { getInboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { storeIncomingMessage } from '@/lib/whatsapp-crm';
import { addChatNote, addLeadNote, deleteNote, listChatNotes, listLeadNotes, NoteError } from '@/lib/leads/notes';
import { cleanupBusinesses, seedBusiness, seedChat } from './fixtures/connect-leads';

const run = enabled ? describe : describe.skip;

run('lead comments from chat notes (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  let B = '';
  let AGENT = '';
  let BOSS = '';
  const agent = () => getInboxViewer({ businessId: B, userId: AGENT });
  const boss = () => getInboxViewer({ businessId: B, userId: BOSS });
  const auto = { source: 'auto' } as const;
  let seq = 0;
  const phone = () => `9170${String(Date.now()).slice(-6)}${String(++seq).padStart(2, '0')}`;

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const col = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'whatsapp_conversation_notes' AND column_name = 'lead_id'`,
    );
    if (!col?.n) throw new Error('Apply migration 452 to kh_phase2_test first');
    const seeded = await seedBusiness('notes');
    B = seeded.businessId;
    AGENT = seeded.agentId;
    BOSS = seeded.supervisorId;
  });

  afterAll(async () => {
    try {
      await cleanupBusinesses([B]);
    } finally {
      await closePool();
    }
  });

  test('a chat note files under the open lead; after a repeat enquiry the chat shows both, tagged by enquiry', async () => {
    const stages = await ensureStages(B);
    const won = stages.find((s) => s.kind === 'won')!;
    const chat = await seedChat(B, { phone: phone() });
    const first = (await openLead(B, { phone: chat.phone, conversationId: chat.id, actor: auto })).lead;

    const n1 = await addChatNote(await boss(), chat.id, 'Wants 50 cartons, quoted Rs 22');
    expect(n1.lead_id).toBe(first.id);

    await setLeadStage(B, first.id, won.id, auto);
    const second = (await openLead(B, { phone: chat.phone, conversationId: chat.id, actor: auto })).lead;
    const n2 = await addChatNote(await boss(), chat.id, 'Back for 100 more');
    expect(n2.lead_id).toBe(second.id);

    const notes = await listChatNotes(await boss(), chat.id);
    expect(notes.map((n) => n.note_text)).toEqual(['Back for 100 more', 'Wants 50 cartons, quoted Rs 22']);
    expect(notes[1]).toMatchObject({ lead_id: first.id, lead_stage_kind: 'won' });
    expect(notes[0]).toMatchObject({ lead_id: second.id, lead_closed_at: null });
    expect(notes[0].user_name).toBeTruthy();

    expect((await listLeadNotes(await boss(), first.id))!.map((n) => n.id)).toEqual([n1.id]);
  });

  test('a note on a lead with no chat shows on the chat once the buyer messages', async () => {
    const p = phone();
    const lead = (await openLead(B, { phone: p, source: 'call', actor: auto })).lead;
    const note = await addLeadNote(await boss(), lead.id, 'Called, wants a price list');
    expect(note.conversation_id).toBeNull();

    const { conversationId } = await storeIncomingMessage(B, `${p}@s.whatsapp.net`, '919999900000', 'Hi, price list please', `in-${randomUUID()}`);
    const chatNotes = await listChatNotes(await boss(), conversationId);
    expect(chatNotes.map((n) => n.id)).toContain(note.id);
  });

  test('a note on a lead with a chat is stored on both', async () => {
    const chat = await seedChat(B, { phone: phone() });
    const lead = (await openLead(B, { phone: chat.phone, conversationId: chat.id, actor: auto })).lead;
    const note = await addLeadNote(await boss(), lead.id, 'Follow up Monday');
    expect(note).toMatchObject({ lead_id: lead.id, conversation_id: chat.id });
  });

  test('only the author or a supervisor deletes a note', async () => {
    const chat = await seedChat(B, { phone: phone() });
    const lead = (await openLead(B, { phone: chat.phone, conversationId: chat.id, actor: auto })).lead;
    const bossNote = await addLeadNote(await boss(), lead.id, 'Boss note');
    // Unowned no-chat leads and unowned chats are visible to agents; make this lead visible to the agent.
    await query(`UPDATE leads SET owner_id = $2 WHERE id = $1`, [lead.id, AGENT]);
    await query(`UPDATE whatsapp_conversations SET inbox_state = 'intervened', assigned_to = $2 WHERE id = $1`, [chat.id, AGENT]);
    const agentNote = await addLeadNote(await agent(), lead.id, 'Agent note');

    await expect(deleteNote(await agent(), bossNote.id)).rejects.toMatchObject({ status: 403, code: 'NOT_AUTHOR' });
    await deleteNote(await agent(), agentNote.id);
    await deleteNote(await boss(), bossNote.id);
    expect(await listLeadNotes(await boss(), lead.id)).toEqual([]);
  });

  test('agents cannot read or write notes of a lead they cannot see', async () => {
    const chat = await seedChat(B, { phone: phone() });
    await query(`UPDATE whatsapp_conversations SET inbox_state = 'intervened', assigned_to = $2 WHERE id = $1`, [chat.id, BOSS]);
    const lead = (await openLead(B, { phone: chat.phone, conversationId: chat.id, actor: auto })).lead;
    const note = await addLeadNote(await boss(), lead.id, 'Private');

    expect(await listLeadNotes(await agent(), lead.id)).toBeNull();
    await expect(addLeadNote(await agent(), lead.id, 'Sneaky')).rejects.toMatchObject({ status: 404 });
    await expect(deleteNote(await agent(), note.id)).rejects.toMatchObject({ status: 404 });
  });

  test('note text is required and capped', async () => {
    const lead = (await openLead(B, { phone: phone(), source: 'call', actor: auto })).lead;
    await expect(addLeadNote(await boss(), lead.id, '   ')).rejects.toBeInstanceOf(NoteError);
    await expect(addLeadNote(await boss(), lead.id, 'x'.repeat(4001))).rejects.toMatchObject({ code: 'NOTE_TOO_LONG' });
  });

  test('deleting a staff member who wrote notes keeps the notes', async () => {
    const lead = (await openLead(B, { phone: phone(), source: 'call', actor: auto })).lead;
    const temp = randomUUID();
    await query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Temp', $3, true, true)`, [
      temp,
      B,
      `8${String(Date.now()).slice(-9)}`,
    ]);
    const note = await addLeadNote(await getInboxViewer({ businessId: B, userId: temp }), lead.id, 'Written by someone who leaves');
    await query(`DELETE FROM users WHERE id = $1`, [temp]);
    const kept = await queryOne<{ user_id: string | null }>(`SELECT user_id FROM whatsapp_conversation_notes WHERE id = $1`, [note.id]);
    expect(kept).toEqual({ user_id: null });
  });

  test('migration 452 files existing notes under the lead open when they were written', async () => {
    const chat = await seedChat(B, { phone: phone() });
    const lead = (await openLead(B, { phone: chat.phone, conversationId: chat.id, actor: auto })).lead;
    await query(`UPDATE leads SET opened_at = NOW() - INTERVAL '10 days' WHERE id = $1`, [lead.id]);
    const before = await queryOne<{ id: string }>(
      `INSERT INTO whatsapp_conversation_notes (conversation_id, business_id, user_id, note_text, created_at)
       VALUES ($1, $2, $3, 'old note', NOW() - INTERVAL '30 days') RETURNING id`,
      [chat.id, B, BOSS],
    );
    const during = await queryOne<{ id: string }>(
      `INSERT INTO whatsapp_conversation_notes (conversation_id, business_id, user_id, note_text, created_at)
       VALUES ($1, $2, $3, 'during the enquiry', NOW() - INTERVAL '2 days') RETURNING id`,
      [chat.id, B, BOSS],
    );
    await query(readFileSync('database/migrations/452_lead_notes.sql', 'utf8'));
    const rows = await query(`SELECT id::text, lead_id::text FROM whatsapp_conversation_notes WHERE id = ANY($1::uuid[])`, [
      [before!.id, during!.id],
    ]);
    const byId = Object.fromEntries(rows.rows.map((r: { id: string; lead_id: string | null }) => [r.id, r.lead_id]));
    expect(byId[before!.id]).toBeNull();
    expect(byId[during!.id]).toBe(lead.id);
  });
});
