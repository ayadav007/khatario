/**
 * Keep BullMQ delayed `todo-{id}` jobs aligned with `todos` after snooze, PATCH, etc.
 * Matches behavior previously inlined in PATCH /api/todos/[id].
 */
import { cancelScheduledTodoReminder, scheduleTodoReminder } from './todoReminderQueue';

export type TodoRowForReminderSync = {
  status: string;
  reminder_type?: string | null;
  reminder_time?: string | Date | null;
  reminder_sent?: boolean | null;
};

export async function syncTodoReminderJobAfterUpdate(
  todoId: string,
  businessId: string,
  updated: TodoRowForReminderSync
): Promise<void> {
  const { hasFeatureAccess } = await import('@/lib/subscription/feature-access');
  const hasAccess = await hasFeatureAccess(businessId, 'todo');

  const noScheduledReminder =
    updated.status === 'completed' ||
    updated.reminder_type === 'none' ||
    !updated.reminder_time;

  if (!hasAccess || noScheduledReminder) {
    await cancelScheduledTodoReminder(todoId);
  }

  if (
    hasAccess &&
    updated.status !== 'completed' &&
    updated.reminder_type &&
    updated.reminder_type !== 'none' &&
    updated.reminder_time &&
    !updated.reminder_sent
  ) {
    await scheduleTodoReminder(todoId, new Date(updated.reminder_time as string));
  }
}
