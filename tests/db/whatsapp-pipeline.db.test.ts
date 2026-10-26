/**
 * Connect pipeline and follow-ups (migration 418): stages, deals on chats, board visibility,
 * the flow "set stage" action and follow-up reminders. Opt-in, disposable DB only:
 *   INBOX_DB_TEST=1 npx jest tests/db/whatsapp-pipeline.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migrations 362 and 418 must be applied there.
 */
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

const mockEmit = jest.fn();
jest.mock('@/lib/whatsapp-websocket', () => ({
  emitConversationUpdate: (...a: unknown[]) => mockEmit(...a),
}));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { query, queryOne, queryRows, closePool } from '@/lib/db';
import type { InboxViewer } from '@/lib/whatsapp/inbox-ownership';
import {
  createStage,
  deleteStage,
  ensureStages,
  loadBoard,
  loadPipelineSummary,
  PipelineError,
  reorderStages,
  setDeal,
  setStageByLegacyKey,
  updateStage,
} from '@/lib/whatsapp/pipeline';
import {
  createFollowup,
  FollowupError,
  listFollowups,
  runDueFollowupReminders,
  updateFollowup,
} from '@/lib/whatsapp/followups';
import { runFlowActions } from '@/lib/whatsapp/flows/actions';

const run = enabled ? describe : describe.skip;

run('Connect pipeline and follow-ups (kh_phase2_test)', () => {
  jest.setTimeout(60000);

  const B = randomUUID();
  const OTHER = randomUUID();
  const ASHA = randomUUID();
  const RAVI = randomUUID();
  const SUP = randomUUID();
  const AGENT_ROLE = randomUUID();
  const SUP_ROLE = randomUUID();
  const tag = B.slice(0, 6);
  let seq = 0;

  const v = (userId: string, isSupervisor = false): InboxViewer => ({ userId, businessId: B, isSupervisor });

  async function newChat(over: { business?: string; state?: string; owner?: string | null; group?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    const phone = `91${String(Date.now()).slice(-6)}${String(++seq).padStart(4, '0')}`;
    await query(
      `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, is_group, inbox_state, assigned_to, last_message_at, whatsapp_display_name)
       VALUES ($1, $2, $3, '919999999999', $3, $4, $5, $6, NOW(), $7)`,
      [id, over.business ?? B, phone, over.group ?? false, over.state ?? 'active', over.owner ?? null, `Lead ${seq}`],
    );
    return id;
  }

  async function code(p: Promise<unknown>): Promise<string> {
    try {
      await p;
      return 'ok';
    } catch (e) {
      if (e instanceof PipelineError || e instanceof FollowupError) return e.code;
      throw e;
    }
  }

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const t = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name IN ('whatsapp_pipeline_stages', 'whatsapp_followups')`,
    );
    if (t?.n !== 2) throw new Error('Apply migration 418 to kh_phase2_test first');

    for (const [id, name] of [[B, `Pipeline ${tag}`], [OTHER, `Other ${tag}`]]) {
      await query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [id, name],
      );
    }
    await query(
      `INSERT INTO user_roles (id, business_id, role_name, role_key) VALUES ($1, $3, 'Agent', 'pagent_${tag}'), ($2, $3, 'Lead', 'plead_${tag}')`,
      [AGENT_ROLE, SUP_ROLE, B],
    );
    await query(
      `INSERT INTO role_permissions (role_id, module_key, can_view) VALUES
         ($1, 'whatsapp_inbox', true), ($2, 'whatsapp_inbox', true), ($2, 'whatsapp_inbox_supervise', true)`,
      [AGENT_ROLE, SUP_ROLE],
    );
    for (const [id, name, role] of [[ASHA, 'Asha', AGENT_ROLE], [RAVI, 'Ravi', AGENT_ROLE], [SUP, 'Sunita', SUP_ROLE]]) {
      await query(
        `INSERT INTO users (id, business_id, name, phone, is_primary_admin, role_id, is_active) VALUES ($1, $2, $3, $4, false, $5, true)`,
        [id, B, name, `7${String(Date.now() + ++seq).slice(-9)}`, role],
      );
    }
  });

  afterAll(async () => {
    try {
      await query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]).catch(() => undefined);
      await query(`DELETE FROM whatsapp_conversations WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]);
      await query(`DELETE FROM whatsapp_pipeline_stages WHERE business_id = ANY($1::uuid[])`, [[B, OTHER]]);
      await query(`DELETE FROM users WHERE business_id = $1`, [B]);
      await query(`DELETE FROM user_roles WHERE business_id = $1`, [B]);
      await query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER]]);
    } finally {
      await closePool();
    }
  });

  beforeEach(() => mockEmit.mockClear());

  test('default stages are created once, in order, with legacy keys', async () => {
    const first = await ensureStages(B);
    const again = await ensureStages(B);
    expect(first.map((s) => s.name)).toEqual(['New', 'Interested', 'Follow up', 'Won', 'Lost']);
    expect(again.map((s) => s.id)).toEqual(first.map((s) => s.id));
    expect(first.find((s) => s.kind === 'won')?.legacy_key).toBe('converted');
  });

  test('moving a deal writes stage, old lead_status, timeline event and a live update', async () => {
    const stages = await ensureStages(B);
    const interested = stages.find((s) => s.name === 'Interested')!;
    const c = await newChat();
    const deal = await setDeal(B, c, { stageId: interested.id, dealValue: 12500.456, expectedCloseOn: '2026-12-01' }, { source: 'agent', userId: ASHA });
    expect(deal).toMatchObject({ stage_id: interested.id, deal_value: 12500.46, expected_close_on: '2026-12-01' });
    const row = await queryOne<{ lead_status: string }>(`SELECT lead_status FROM whatsapp_conversations WHERE id = $1`, [c]);
    expect(row?.lead_status).toBe('interested');
    const ev = await queryOne<{ event_data: any }>(
      `SELECT event_data FROM whatsapp_automation_events WHERE conversation_id = $1 AND event_type = 'stage_changed'`,
      [c],
    );
    expect(ev?.event_data).toMatchObject({ to_stage: 'Interested', from_stage: null, source: 'agent', actor_name: 'Asha' });
    expect(mockEmit).toHaveBeenCalled();

    // Lost keeps the reason; moving on clears it.
    const lost = stages.find((s) => s.kind === 'lost')!;
    expect((await setDeal(B, c, { stageId: lost.id, lostReason: '  Price  ' }, { source: 'agent', userId: ASHA })).lost_reason).toBe('Price');
    expect((await setDeal(B, c, { stageId: interested.id }, { source: 'agent', userId: ASHA })).lost_reason).toBeNull();
  });

  test('rejects another business’s stage, group chats and bad values', async () => {
    const otherStages = await ensureStages(OTHER);
    const c = await newChat();
    expect(await code(setDeal(B, c, { stageId: otherStages[0].id }, { source: 'flow' }))).toBe('STAGE_NOT_FOUND');
    const g = await newChat({ group: true });
    const stages = await ensureStages(B);
    expect(await code(setDeal(B, g, { stageId: stages[0].id }, { source: 'flow' }))).toBe('GROUP_CHAT');
    expect(await code(setDeal(B, c, { dealValue: -5 }, { source: 'flow' }))).toBe('BAD_VALUE');
    expect(await code(setDeal(B, c, { expectedCloseOn: '01/12/2026' }, { source: 'flow' }))).toBe('BAD_DATE');
    // A chat in another business is not found.
    const foreign = await newChat({ business: OTHER });
    expect(await code(setDeal(B, foreign, { dealValue: 1 }, { source: 'flow' }))).toBe('NOT_FOUND');
  });

  test('board: agents only see chats they could open; totals and won window', async () => {
    const stages = await ensureStages(B);
    const fu = stages.find((s) => s.name === 'Follow up')!;
    const won = stages.find((s) => s.kind === 'won')!;
    const mine = await newChat({ state: 'intervened', owner: ASHA });
    const ravis = await newChat({ state: 'intervened', owner: RAVI });
    const oldWin = await newChat();
    await setDeal(B, mine, { stageId: fu.id, dealValue: 1000 }, { source: 'flow' });
    await setDeal(B, ravis, { stageId: fu.id, dealValue: 2000 }, { source: 'flow' });
    await setDeal(B, oldWin, { stageId: won.id, dealValue: 500 }, { source: 'flow' });
    await query(`UPDATE whatsapp_conversations SET stage_changed_at = NOW() - INTERVAL '200 days' WHERE id = $1`, [oldWin]);

    const asha = await loadBoard(v(ASHA));
    const ashaFu = asha.find((c) => c.id === fu.id)!;
    expect(ashaFu.cards.map((c) => c.id)).toContain(mine);
    expect(ashaFu.cards.map((c) => c.id)).not.toContain(ravis);
    expect(ashaFu.cards.find((c) => c.id === mine)?.owner_name).toBe('Asha');

    const sup = await loadBoard(v(SUP, true));
    const supFu = sup.find((c) => c.id === fu.id)!;
    expect(supFu.cards.map((c) => c.id)).toEqual(expect.arrayContaining([mine, ravis]));
    expect(supFu.total_value).toBeGreaterThanOrEqual(3000);
    expect(sup.find((c) => c.id === won.id)!.cards.map((c) => c.id)).not.toContain(oldWin);
    expect((await loadBoard(v(SUP, true), { closedDays: 365 })).find((c) => c.id === won.id)!.cards.map((c) => c.id)).toContain(oldWin);

    const byRavi = await loadBoard(v(SUP, true), { ownerId: RAVI });
    expect(byRavi.find((c) => c.id === fu.id)!.cards.map((c) => c.id)).toEqual([ravis]);
  });

  test('stage admin: open stages go before won/lost, reorder needs every stage, delete moves chats', async () => {
    const quoted = await createStage(B, { name: 'Quoted', color: 'teal' });
    let stages = await ensureStages(B);
    const names = stages.map((s) => s.name);
    expect(names.indexOf('Quoted')).toBeLessThan(names.indexOf('Won'));
    expect(await code(createStage(B, { name: 'quoted' }))).toBe('DUPLICATE');
    expect(await code(reorderStages(B, [quoted.id]))).toBe('BAD_ORDER');
    const reversed = await reorderStages(B, [...stages].reverse().map((s) => s.id));
    expect(reversed[0].id).toBe(stages[stages.length - 1].id);

    const c = await newChat();
    await setDeal(B, c, { stageId: quoted.id }, { source: 'flow' });
    const target = stages.find((s) => s.name === 'Interested')!;
    expect(await code(deleteStage(B, quoted.id, quoted.id))).toBe('BAD_TARGET');
    await deleteStage(B, quoted.id, target.id);
    const row = await queryOne<{ stage_id: string }>(`SELECT stage_id::text AS stage_id FROM whatsapp_conversations WHERE id = $1`, [c]);
    expect(row?.stage_id).toBe(target.id);
    stages = await ensureStages(B);
    expect(stages.some((s) => s.id === quoted.id)).toBe(false);
  });

  test('AI "when qualified" status still finds its stage after a rename; flow action moves stage', async () => {
    const stages = await ensureStages(B);
    const interested = stages.find((s) => s.legacy_key === 'interested')!;
    await updateStage(B, interested.id, { name: 'Hot enquiry' });
    const c = await newChat();
    await setStageByLegacyKey(B, c, 'interested', { source: 'ai' });
    expect((await queryOne<{ stage_id: string }>(`SELECT stage_id::text AS stage_id FROM whatsapp_conversations WHERE id = $1`, [c]))?.stage_id).toBe(
      interested.id,
    );

    const won = stages.find((s) => s.kind === 'won')!;
    await runFlowActions(B, c, [
      { id: 'a1', type: 'action', position: { x: 0, y: 0 }, data: { kind: 'set_stage', stageId: won.id, labelIds: [], catalogBody: '', catalogFooter: '' } },
    ]);
    const after = await queryOne<{ stage_id: string; lead_status: string }>(
      `SELECT stage_id::text AS stage_id, lead_status FROM whatsapp_conversations WHERE id = $1`,
      [c],
    );
    expect(after).toEqual({ stage_id: won.id, lead_status: 'converted' });
    const last = await queryOne<{ event_data: any }>(
      `SELECT event_data FROM whatsapp_automation_events WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [c],
    );
    expect(last?.event_data).toMatchObject({ source: 'flow', to_stage: 'Won', from_stage: 'Hot enquiry' });
  });

  test('follow-ups: who can set, see and change them', async () => {
    const c = await newChat({ state: 'intervened', owner: ASHA });
    const inHour = new Date(Date.now() + 3600_000).toISOString();
    expect(await code(createFollowup(v(ASHA), { conversationId: c, dueAt: inHour, assignedTo: RAVI }))).toBe('NOT_SUPERVISOR');
    expect(await code(createFollowup(v(ASHA), { conversationId: c, dueAt: new Date(Date.now() - 86400_000).toISOString() }))).toBe('DUE_IN_PAST');
    const mine = await createFollowup(v(ASHA), { conversationId: c, dueAt: inHour, note: ' send quote ' });
    expect(mine).toMatchObject({ assigned_to: ASHA, note: 'send quote', status: 'pending', assigned_name: 'Asha' });
    const forRavi = await createFollowup(v(SUP, true), { conversationId: c, dueAt: inHour, assignedTo: RAVI });
    expect(forRavi.assigned_to).toBe(RAVI);

    const eod = new Date(Date.now() + 2 * 3600_000).toISOString();
    const ashaList = await listFollowups(v(ASHA), { when: 'due', dueBefore: eod });
    expect(ashaList.followups.map((f) => f.id)).toEqual([mine.id]);
    expect(ashaList.counts).toEqual({ overdue: 0, today: 1 });
    // An agent asking for everyone still gets only their own.
    expect((await listFollowups(v(ASHA), { all: true })).followups.map((f) => f.id)).toEqual([mine.id]);
    expect((await listFollowups(v(SUP, true), { all: true, conversationId: c })).followups).toHaveLength(2);

    expect(await code(updateFollowup(v(RAVI), mine.id, { status: 'done' }))).toBe('NOT_FOUND');
    const done = await updateFollowup(v(ASHA), mine.id, { status: 'done' });
    expect(done.status).toBe('done');
    const snoozed = await updateFollowup(v(ASHA), mine.id, { dueAt: new Date(Date.now() + 86400_000).toISOString() });
    expect(snoozed).toMatchObject({ status: 'pending', notified_at: null, completed_at: null });
  });

  test('cron notifies once per due reminder and cancels cancel-on-reply ones the customer answered', async () => {
    const c = await newChat({ state: 'intervened', owner: ASHA });
    const due = await queryOne<{ id: string }>(
      `INSERT INTO whatsapp_followups (business_id, conversation_id, assigned_to, created_by, due_at, note)
       VALUES ($1, $2, $3, $3, NOW() - INTERVAL '1 minute', 'call back') RETURNING id::text AS id`,
      [B, c, ASHA],
    );
    const replied = await queryOne<{ id: string }>(
      `INSERT INTO whatsapp_followups (business_id, conversation_id, assigned_to, created_by, due_at, cancel_on_reply, created_at)
       VALUES ($1, $2, $3, $3, NOW() - INTERVAL '1 minute', true, NOW() - INTERVAL '1 hour') RETURNING id::text AS id`,
      [B, c, ASHA],
    );
    await query(
      `INSERT INTO whatsapp_conversation_messages (business_id, conversation_id, message_id, from_number, to_number, message_text, direction, created_at)
       SELECT business_id, id, $2, from_number, to_number, 'yes please', 'incoming', NOW() - INTERVAL '10 minutes'
         FROM whatsapp_conversations WHERE id = $1`,
      [c, `wamid.${randomUUID()}`],
    );

    // Overdue counts skip the answered cancel-on-reply reminder.
    expect((await listFollowups(v(ASHA), { conversationId: c })).followups.map((f) => f.id)).toEqual([due!.id]);

    await runDueFollowupReminders();
    await runDueFollowupReminders();
    const rows = await queryRows<{ id: string; status: string; notified: boolean }>(
      `SELECT id::text AS id, status, notified_at IS NOT NULL AS notified FROM whatsapp_followups WHERE conversation_id = $1 ORDER BY due_at`,
      [c],
    );
    expect(rows.find((r) => r.id === due!.id)).toMatchObject({ status: 'pending', notified: true });
    expect(rows.find((r) => r.id === replied!.id)).toMatchObject({ status: 'cancelled' });
    const notes = await queryRows<{ message: string }>(
      `SELECT message FROM notifications WHERE business_id = $1 AND user_id = $2 AND reference_id = $3`,
      [B, ASHA, c],
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toMatch(/call back/);
  });
  test('dashboard summary: open value, wins and losses in the window, lost reasons, per agent', async () => {
    const stages = await ensureStages(B);
    const won = stages.find((s) => s.kind === 'won')!;
    const lost = stages.find((s) => s.kind === 'lost')!;
    const w = await newChat({ state: 'intervened', owner: RAVI });
    const l = await newChat();
    await setDeal(B, w, { stageId: won.id, dealValue: 7000 }, { source: 'flow' });
    await setDeal(B, l, { stageId: lost.id, lostReason: 'Too costly' }, { source: 'flow' });
    const sum = await loadPipelineSummary(B, 30);
    expect(sum.won.count).toBeGreaterThanOrEqual(2);
    expect(sum.won.value).toBeGreaterThanOrEqual(7000);
    expect(sum.lost).toBeGreaterThanOrEqual(1);
    expect(sum.win_rate).not.toBeNull();
    expect(sum.lost_reasons).toEqual(expect.arrayContaining([{ reason: 'too costly', count: 1 }]));
    expect(sum.by_agent.find((a) => a.agent_id === RAVI)).toMatchObject({ agent_name: 'Ravi', won: 1, won_value: 7000 });
    // Another business sees none of it.
    expect((await loadPipelineSummary(OTHER, 30)).won.count).toBe(0);
  });
});
