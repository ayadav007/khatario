jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
  query: jest.fn(),
  queryOne: jest.fn(),
  queryRows: jest.fn(),
}));
jest.mock('@/lib/permissions', () => ({ checkUserPermission: jest.fn() }));
jest.mock('@/lib/whatsapp-websocket', () => ({ emitConversationUpdate: jest.fn() }));

import {
  UNOWNED_SQL,
  canReply,
  canResolve,
  canTakeOver,
  canTransfer,
  liveOwnerId,
  ownershipView,
  queueIfUnanswered,
  visibilityClause,
  type InboxViewer,
  type OwnershipRow,
} from '@/lib/whatsapp/inbox-ownership';
import { describeOwnershipEvent, type OwnershipEvent } from '@/components/whatsapp/conversations/inbox';
import { getPool } from '@/lib/db';

const B = '11111111-1111-1111-1111-111111111111';
const ME = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';

const agent: InboxViewer = { userId: ME, businessId: B, isSupervisor: false };
const supervisor: InboxViewer = { userId: ME, businessId: B, isSupervisor: true };

function row(over: Partial<OwnershipRow> = {}): OwnershipRow {
  return {
    id: 'c1',
    business_id: B,
    inbox_state: 'active',
    assigned_to: null,
    owner_active: false,
    owner_name: null,
    is_group: false,
    ...over,
  };
}

const ownedBy = (id: string, active = true) =>
  row({ inbox_state: 'intervened', assigned_to: id, owner_active: active, owner_name: id === ME ? 'Me' : 'Ravi' });

describe('visibilityClause', () => {
  test('supervisors see everything with no params', () => {
    expect(visibilityClause(supervisor, 'c', 3)).toEqual({ sql: 'TRUE', params: [] });
  });

  test('agents get owned-by-me OR unowned-with-label-rules, bound to the next param', () => {
    const v = visibilityClause(agent, 'wc', 4);
    expect(v.params).toEqual([ME]);
    expect(v.sql).toContain(`wc.inbox_state = 'intervened' AND wc.assigned_to = $4::uuid`);
    expect(v.sql).toContain(UNOWNED_SQL('wc'));
    expect(v.sql).toContain('whatsapp_agent_label_rules');
    expect(v.sql).not.toContain('$5');
  });
});

describe('ownership rules', () => {
  test('liveOwnerId ignores deactivated owners and non-intervened chats', () => {
    expect(liveOwnerId(ownedBy(OTHER))).toBe(OTHER);
    expect(liveOwnerId(ownedBy(OTHER, false))).toBeNull();
    expect(liveOwnerId(row({ inbox_state: 'requesting', assigned_to: OTHER, owner_active: true }))).toBeNull();
  });

  test('only the owner replies; groups are open to all', () => {
    expect(canReply(agent, ownedBy(ME))).toBe(true);
    expect(canReply(agent, ownedBy(OTHER))).toBe(false);
    expect(canReply(supervisor, ownedBy(OTHER))).toBe(false);
    expect(canReply(agent, row())).toBe(false);
    expect(canReply(agent, row({ is_group: true }))).toBe(true);
  });

  test('transfer: owner or supervisor', () => {
    expect(canTransfer(agent, ownedBy(ME))).toBe(true);
    expect(canTransfer(agent, ownedBy(OTHER))).toBe(false);
    expect(canTransfer(agent, row({ inbox_state: 'requesting' }))).toBe(false);
    expect(canTransfer(supervisor, row({ inbox_state: 'requesting' }))).toBe(true);
  });

  test('take over: supervisors only, not their own chat', () => {
    expect(canTakeOver(agent, ownedBy(OTHER))).toBe(false);
    expect(canTakeOver(supervisor, ownedBy(OTHER))).toBe(true);
    expect(canTakeOver(supervisor, ownedBy(ME))).toBe(false);
  });

  test('resolve: never for active chats; owner or supervisor otherwise', () => {
    expect(canResolve(supervisor, row())).toBe(false);
    expect(canResolve(agent, ownedBy(ME))).toBe(true);
    expect(canResolve(agent, ownedBy(OTHER))).toBe(false);
    expect(canResolve(agent, row({ inbox_state: 'requesting' }))).toBe(false);
    expect(canResolve(supervisor, row({ inbox_state: 'requesting' }))).toBe(true);
  });
});

describe('ownershipView', () => {
  test('unowned requesting chat: agent may intervene but not reply', () => {
    expect(ownershipView(agent, row({ inbox_state: 'requesting' }))).toMatchObject({
      inbox_state: 'requesting',
      assigned_to: null,
      can_reply: false,
      can_intervene: true,
      can_transfer: false,
      can_take_over: false,
      can_resolve: false,
    });
  });

  test('my chat: reply, transfer and resolve', () => {
    expect(ownershipView(agent, ownedBy(ME))).toMatchObject({
      inbox_state: 'intervened',
      assigned_to: ME,
      owner_name: 'Me',
      can_reply: true,
      can_intervene: false,
      can_transfer: true,
      can_resolve: true,
      can_take_over: false,
    });
  });

  test('supervisor viewing someone else’s chat', () => {
    expect(ownershipView(supervisor, ownedBy(OTHER))).toMatchObject({
      assigned_to: OTHER,
      owner_name: 'Ravi',
      is_supervisor: true,
      can_reply: false,
      can_intervene: false,
      can_take_over: true,
      can_transfer: true,
      can_resolve: true,
    });
  });

  test('an intervened chat with a deactivated owner shows as requesting', () => {
    expect(ownershipView(agent, ownedBy(OTHER, false))).toMatchObject({
      inbox_state: 'requesting',
      assigned_to: null,
      owner_name: null,
      can_intervene: true,
    });
  });

  test('groups cannot be intervened, transferred or taken over', () => {
    expect(ownershipView(supervisor, row({ is_group: true }))).toMatchObject({
      can_reply: true,
      can_intervene: false,
      can_transfer: false,
      can_take_over: false,
    });
  });
});

describe('queueIfUnanswered', () => {
  beforeEach(() => (getPool as jest.Mock).mockReset());

  test.each([
    ['no conversation', undefined, { replied: false }],
    ['bot replied', 'c1', { replied: true }],
    ['handled without a reply', 'c1', { replied: false, handled: true }],
    ['group', 'c1', { replied: false, isGroup: true }],
  ])('skips when %s', async (_l, conv, outcome) => {
    await queueIfUnanswered(B, conv as string | undefined, outcome);
    expect(getPool).not.toHaveBeenCalled();
  });

  test('queues an unanswered message and swallows DB errors', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (getPool as jest.Mock).mockReturnValue({ connect: jest.fn().mockRejectedValue(new Error('down')) });
    await expect(queueIfUnanswered(B, 'c1', { replied: false })).resolves.toBeUndefined();
    expect(getPool).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('describeOwnershipEvent', () => {
  const ev = (over: Partial<OwnershipEvent>): OwnershipEvent => ({
    id: 'e',
    type: 'intervened',
    actor_user_id: OTHER,
    actor_name: 'Asha',
    target_user_id: null,
    target_name: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  });

  test('names people, and says You/you for the viewer', () => {
    expect(describeOwnershipEvent(ev({}), ME)).toBe('Asha intervened');
    expect(describeOwnershipEvent(ev({ actor_user_id: ME }), ME)).toBe('You intervened');
    expect(
      describeOwnershipEvent(ev({ type: 'transferred', target_user_id: ME, target_name: 'Me' }), ME),
    ).toBe('Asha transferred the chat to you');
    expect(
      describeOwnershipEvent(ev({ type: 'transferred', target_user_id: 'x', target_name: 'Ravi' }), ME),
    ).toBe('Asha transferred the chat to Ravi');
  });

  test('system events without an actor', () => {
    expect(
      describeOwnershipEvent(ev({ type: 'transferred', actor_user_id: null, target_user_id: 'x', target_name: 'Ravi' })),
    ).toBe('Chat assigned to Ravi');
    expect(describeOwnershipEvent(ev({ type: 'auto_resolved', actor_user_id: null }))).toMatch(/auto-resolved/);
    expect(describeOwnershipEvent(ev({ type: 'requested', actor_user_id: null }))).toMatch(/waiting/);
    expect(describeOwnershipEvent(ev({ type: 'released', actor_user_id: null }))).toMatch(/Requesting/);
  });
});
