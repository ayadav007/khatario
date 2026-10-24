import type { PoolClient } from 'pg';
import { getPool, query, queryOne } from '@/lib/db';
import { reminderPipelineLog } from '@/lib/reminder-pipeline-log';
import { getRedisConnection } from '@/lib/queue/redis';
import { getBusinessSubscription, hasFeature, isSubscriptionOperationalStatus } from '@/lib/subscription';
import { sendWhatsAppMessage, getWhatsAppStatus } from '@/lib/whatsapp';

/** Row shape for reminder delivery; callers pass a `todos` record (e.g. SELECT *). */
export type TodoForReminder = {
  id: string;
  business_id: string;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  created_by: string | null;
  due_date: string | Date;
  reminder_channels?: string[] | null;
  reminder_type?: string | null;
};

export type TriggerTodoReminderResult = {
  status: 'delivered' | 'skipped' | 'invalid';
  reason?: string;
  published?: { userId: string; notificationId: string }[];
};

const NOTIFICATIONS_CHANNEL = 'notifications';

const DELIVERABLE_STATUSES = ['pending', 'in_progress', 'overdue'];

/**
 * Claims the reminder only if the row is still due right now, so a stale batch row or an old
 * BullMQ job cannot deliver after a snooze, completion or reminder change.
 */
const CLAIM_SQL = `UPDATE todos
   SET reminder_sent = true, last_reminder_sent_at = NOW()
 WHERE id = $1
   AND reminder_sent = false
   AND status IN ('pending', 'in_progress', 'overdue')
   AND reminder_type IS NOT NULL
   AND reminder_type <> 'none'
   AND reminder_time IS NOT NULL
   AND reminder_time <= NOW()
 RETURNING *`;

/** notifications.user_id -> users(id): the recipient no longer exists. */
const RECIPIENT_FK = { table: 'notifications', constraint: 'notifications_user_id_fkey' };

function isDeletedRecipientError(err: unknown): boolean {
  const e = err as { code?: string; table?: string; constraint?: string } | null;
  return e?.code === '23503' && e.table === RECIPIENT_FK.table && e.constraint === RECIPIENT_FK.constraint;
}

/**
 * Deduplicate users (e.g. assignee === creator).
 */
function inAppRecipientUserIds(todo: TodoForReminder): string[] {
  return [
    ...new Set(
      [todo.assigned_to, todo.created_by].filter((x): x is string => Boolean(x))
    ),
  ];
}

function whatsAppRecipientUserId(todo: TodoForReminder): string | null {
  return todo.assigned_to || todo.created_by || null;
}

function publishNotificationsChannel(
  businessId: string,
  userId: string,
  notificationId: string,
  content: { title: string; message: string; referenceId: string }
): void {
  try {
    const redis = getRedisConnection();
    if (!redis || redis.status !== 'ready') {
      reminderPipelineLog('service.redis_publish.skip_not_ready', {
        businessId,
        userId,
        notificationId,
        redisStatus: redis?.status ?? 'null',
      });
      return;
    }
    const payload = {
      type: 'todo_reminder',
      businessId,
      userId,
      notificationId,
      title: content.title,
      message: content.message,
      reference_id: content.referenceId,
      timestamp: Date.now(),
    };
    reminderPipelineLog('service.redis_publish.sending', payload);
    void redis
      .publish(NOTIFICATIONS_CHANNEL, JSON.stringify(payload))
      .then((n) => {
        reminderPipelineLog('service.redis_publish.ok', {
          businessId,
          userId,
          notificationId,
          subscribers: n,
        });
      })
      .catch((err) => {
        reminderPipelineLog('service.redis_publish.fail', {
          notificationId,
          error: String(err),
        });
        console.error('[todoReminderService] Redis publish failed (non-fatal):', err);
      });
  } catch (err) {
    reminderPipelineLog('service.redis_publish.exception', { error: String(err) });
    console.error('[todoReminderService] Redis publish error (non-fatal):', err);
  }
}

/**
 * Deliver todo reminder: claim row (idempotent), notify assignee and creator, Redis SSE, optional WhatsApp.
 * `snapshot` (a batch row or the worker's read) only pre-filters; the claimed row is re-checked
 * and supplies everything that is delivered. The claim, every recipient row and the history
 * entry commit together: an unexpected insert failure rolls all of it back and throws, leaving
 * the reminder due for the next attempt. Only a recipient that no longer exists is skipped.
 * Redis and WhatsApp failures never throw from this function for operational paths.
 */
export async function triggerTodoReminder(
  snapshot: TodoForReminder
): Promise<TriggerTodoReminderResult> {
  reminderPipelineLog('service.trigger.start', {
    todoId: snapshot.id,
    status: snapshot.status,
    business_id: snapshot.business_id,
    reminder_sent: (snapshot as { reminder_sent?: boolean }).reminder_sent,
  });

  if (!DELIVERABLE_STATUSES.includes(snapshot.status)) {
    reminderPipelineLog('service.trigger.invalid', { todoId: snapshot.id, reason: 'bad_status' });
    return { status: 'invalid', reason: 'bad_status' };
  }

  if (inAppRecipientUserIds(snapshot).length === 0) {
    reminderPipelineLog('service.trigger.invalid', { todoId: snapshot.id, reason: 'no_user' });
    return { status: 'invalid', reason: 'no_user' };
  }

  const subscription = await getBusinessSubscription(snapshot.business_id);
  if (!subscription || !isSubscriptionOperationalStatus(subscription.status)) {
    reminderPipelineLog('service.trigger.skipped', { todoId: snapshot.id, reason: 'subscription' });
    return { status: 'skipped', reason: 'subscription' };
  }

  if (subscription.end_date) {
    const endDate = new Date(subscription.end_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (endDate < today) {
      reminderPipelineLog('service.trigger.skipped', {
        todoId: snapshot.id,
        reason: 'subscription_expired',
      });
      return { status: 'skipped', reason: 'subscription_expired' };
    }
  }

  const pool = getPool();
  const client: PoolClient = await pool.connect();

  const published: { userId: string; notificationId: string }[] = [];
  let todo: TodoForReminder;
  let title: string;
  let message: string;

  try {
    await client.query('BEGIN');

    const claim = await client.query<TodoForReminder>(CLAIM_SQL, [snapshot.id]);
    if (!claim.rowCount) {
      await client.query('ROLLBACK');
      reminderPipelineLog('service.trigger.not_claimed', {
        todoId: snapshot.id,
        hint: 'already sent, no longer due, or row missing',
      });
      return { status: 'skipped', reason: 'not_claimed' };
    }
    todo = claim.rows[0];

    const inAppUsers = inAppRecipientUserIds(todo);
    if (inAppUsers.length === 0) {
      await client.query('ROLLBACK');
      reminderPipelineLog('service.trigger.invalid', { todoId: todo.id, reason: 'no_user' });
      return { status: 'invalid', reason: 'no_user' };
    }

    reminderPipelineLog('service.trigger.claimed', { todoId: todo.id });

    title = `Reminder: ${todo.title}`;
    message = todo.description || `Your task "${todo.title}" is due soon.`;

    for (let i = 0; i < inAppUsers.length; i++) {
      const userId = inAppUsers[i];
      const sp = `tr_rem_${i}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO notifications (
            business_id, user_id, type, title, message, reference_type, reference_id, created_at
          ) VALUES ($1, $2, 'todo_reminder', $3, $4, 'todo', $5, NOW())
          ON CONFLICT (user_id, reference_id) WHERE (type = 'todo_reminder')
          DO UPDATE SET
            title = EXCLUDED.title,
            message = EXCLUDED.message,
            is_read = false,
            read_at = NULL,
            created_at = NOW()
          RETURNING id`,
          [todo.business_id, userId, title, message, todo.id]
        );
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        const nid = ins.rows[0]?.id;
        if (nid) {
          published.push({ userId, notificationId: nid });
          reminderPipelineLog('service.notification.upserted', {
            todoId: todo.id,
            notificationId: nid,
            userId,
          });
        }
      } catch (insertErr) {
        if (!isDeletedRecipientError(insertErr)) throw insertErr;
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        reminderPipelineLog('service.notification.recipient_deleted', { todoId: todo.id, userId });
      }
    }

    if (published.length > 0) {
      await client.query(
        `SELECT create_todo_history($1, 'reminder_sent', NULL, NULL, NULL)`,
        [todo.id]
      );
    }
    // Every recipient is gone: keep the claim so the reminder is not retried forever.
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw e;
  } finally {
    client.release();
  }

  if (published.length === 0) {
    reminderPipelineLog('service.trigger.recipients_deleted', { todoId: todo.id });
    return { status: 'skipped', reason: 'recipients_deleted' };
  }

  reminderPipelineLog('service.trigger.publishing_sse', {
    todoId: todo.id,
    count: published.length,
  });

  for (const p of published) {
    publishNotificationsChannel(
      todo.business_id,
      p.userId,
      p.notificationId,
      {
        title,
        message,
        referenceId: todo.id,
      }
    );
  }

  await trySendWhatsAppForTodo(todo, whatsAppRecipientUserId(todo));

  return { status: 'delivered', published };
}

async function trySendWhatsAppForTodo(
  todo: TodoForReminder,
  waUserId: string | null
): Promise<void> {
  if (!waUserId) return;
  if (
    !todo.reminder_channels ||
    !Array.isArray(todo.reminder_channels) ||
    !todo.reminder_channels.includes('whatsapp')
  ) {
    return;
  }

  try {
    const hasWhatsAppAccess = await hasFeature(todo.business_id, 'whatsapp_bot');
    if (!hasWhatsAppAccess) return;

    let whatsappStatus;
    try {
      whatsappStatus = await getWhatsAppStatus(todo.business_id);
    } catch {
      whatsappStatus = null;
    }
    if (!whatsappStatus || whatsappStatus.status !== 'connected') {
      return;
    }

    const user = await queryOne<{ phone: string; name: string }>(
      `SELECT phone, name FROM users WHERE id = $1 AND phone IS NOT NULL AND phone != ''`,
      [waUserId]
    );
    if (!user?.phone) return;

    const message =
      `📋 *Todo Reminder*\n\n` +
      `*${todo.title}*\n` +
      `${todo.description || 'No description provided'}\n\n` +
      `Due: ${new Date(todo.due_date).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })}`;

    try {
      await sendWhatsAppMessage(
        todo.business_id,
        user.phone,
        message,
        undefined,
        'text'
      );
    } catch (sendError: any) {
      console.error(
        '[todoReminderService] WhatsApp send failed (non-critical):',
        sendError?.message || sendError
      );
      return;
    }

    try {
      await query(
        `INSERT INTO whatsapp_messages (
          business_id, to_number, message_type, reference_type, 
          reference_id, message_text, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          todo.business_id,
          user.phone,
          'reminder',
          'todo',
          todo.id,
          message,
          'sent',
        ]
      );
    } catch (logError: any) {
      console.error(
        '[todoReminderService] WhatsApp log failed (non-critical):',
        logError?.message || logError
      );
    }
  } catch (e: any) {
    console.error(
      '[todoReminderService] WhatsApp path failed (non-critical):',
      e?.message || e
    );
  }
}
