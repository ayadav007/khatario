/**
 * BullMQ todo-reminders job handler: missing todo id, missing todo, skipped/invalid results and
 * rethrown delivery errors (so BullMQ marks the job failed and the DB sweep retries).
 */
const mockQueryOne = jest.fn();
jest.mock('@/lib/db', () => ({ queryOne: (...a: unknown[]) => mockQueryOne(...a) }));
const mockTrigger = jest.fn();
jest.mock('@/lib/services/todoReminderService', () => ({
  triggerTodoReminder: (...a: unknown[]) => mockTrigger(...a),
}));
const mockLog = jest.fn();
jest.mock('@/lib/todo-reminders/reminderLog', () => ({ logTodoReminder: (...a: unknown[]) => mockLog(...a) }));
jest.mock('@/lib/reminder-pipeline-log', () => ({ reminderPipelineLog: jest.fn() }));

import { processTodoReminderJob } from '@/lib/todo-reminders/processReminderJob';

const TODO = { id: 't1', business_id: 'b1', status: 'pending', title: 'x', assigned_to: 'u1' };
const job = (data: unknown) => ({ id: 'todo-t1', data, attemptsMade: 0 });

beforeEach(() => {
  mockQueryOne.mockReset().mockResolvedValue(TODO);
  mockTrigger.mockReset();
  mockLog.mockReset();
});

it('fails a job without a todo id', async () => {
  await expect(processTodoReminderJob(job({}))).rejects.toThrow('missing todoId');
  expect(mockQueryOne).not.toHaveBeenCalled();
});

it('completes without delivering when the todo no longer exists', async () => {
  mockQueryOne.mockResolvedValueOnce(null);
  await expect(processTodoReminderJob(job({ todoId: 't1' }))).resolves.toBeUndefined();
  expect(mockTrigger).not.toHaveBeenCalled();
  expect(mockLog).toHaveBeenCalledWith('worker', 'skipped', expect.objectContaining({ reason: 'todo_not_found' }));
});

it('reads the current row by id and hands it to the claim', async () => {
  mockTrigger.mockResolvedValueOnce({ status: 'delivered', published: [{ userId: 'u1', notificationId: 'n1' }] });
  await processTodoReminderJob(job({ todoId: 't1' }));
  expect(mockQueryOne).toHaveBeenCalledWith('SELECT * FROM todos WHERE id = $1', ['t1']);
  expect(mockTrigger).toHaveBeenCalledWith(TODO);
  expect(mockLog).toHaveBeenCalledWith('worker', 'processed', expect.objectContaining({ notificationCount: 1 }));
});

it.each([
  [{ status: 'skipped', reason: 'not_claimed' }, {}],
  [{ status: 'invalid', reason: 'no_user' }, { outcome: 'invalid' }],
])('completes (no retry) for %o', async (result, extra) => {
  mockTrigger.mockResolvedValueOnce(result);
  await expect(processTodoReminderJob(job({ todoId: 't1' }))).resolves.toBeUndefined();
  expect(mockLog).toHaveBeenCalledWith('worker', 'skipped', expect.objectContaining({ reason: result.reason, ...extra }));
});

it('rethrows delivery errors so the job is marked failed', async () => {
  mockTrigger.mockRejectedValueOnce(Object.assign(new Error('deadlock'), { code: '40P01' }));
  await expect(processTodoReminderJob(job({ todoId: 't1' }))).rejects.toThrow('deadlock');
  expect(mockLog).toHaveBeenCalledWith('worker', 'failed', expect.objectContaining({ error: 'deadlock' }));
});
