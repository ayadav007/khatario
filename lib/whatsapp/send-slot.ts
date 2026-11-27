/**
 * One automatic WhatsApp send = one reserved place under the plan's daily cap.
 *
 * `withWhatsAppSlot` inserts the `whatsapp_messages` row (status `sending`) through the WhatsApp limit lock
 * (`limitedQueryOne(..., 'whatsapp', ...)`: count and insert as one step per business), then runs the send. The row
 * is what `checkLimit(..., 'whatsapp')` counts, so a second automatic send at cap - 1 is refused before it sends.
 *
 * - The send succeeded: the row becomes `sent` (message text, provider id and amount are filled in).
 * - The send threw, or the caller says it was not delivered: the row becomes `failed` with the error and its
 *   `sent_at` is cleared. The counter only counts rows with `sent_at` today, so a failed send does not use up the
 *   quota, and the row stays as the record of the attempt.
 * - Inside the slot, `sendWhatsAppMessage` and the reminder sender do not write a second row (`currentSlot()`),
 *   so one send is counted once.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { query } from '@/lib/db';
import { LimitRefusedError, withLimitedCreate } from '@/lib/subscription/limit-lock';

export type SlotMeta = {
  to: string;
  messageType: string;
  referenceType?: string | null;
  referenceId?: string | null;
  text?: string | null;
  reminderSource?: string | null;
  amountDue?: number | null;
  batchId?: string | null;
  /**
   * More bills listed in the same message (statement reminders): each gets its own log row, reserved in the same
   * step, so one message is one atomic reservation (`1 + extra.length` places) and its rows are written together.
   */
  extra?: Array<{ referenceId: string; reminderSource?: string | null; amountDue?: number | null }>;
};

export type Slot = {
  id: string;
  ids: string[];
  text?: string | null;
  mediaUrl?: string | null;
  providerId?: string | null;
  amountDue?: number | null;
  to?: string | null;
  error?: string | null;
};

const store = new AsyncLocalStorage<Slot>();
const replyStore = new AsyncLocalStorage<true>();

/**
 * Run `fn` as a reply to a customer's own message (bot rule, flow, AI or shop reply). Such a reply does not count
 * toward the daily WhatsApp cap and is not refused by it: `sendWhatsAppMessage` writes no `whatsapp_messages` row for
 * it (inbox history comes from the conversation messages, which are unchanged).
 */
export function asCustomerReply<T>(fn: () => Promise<T>): Promise<T> {
  return replyStore.run(true, fn);
}

export function inCustomerReply(): boolean {
  return replyStore.getStore() === true;
}

/** The slot of the send in progress, or undefined outside one. */
export function currentSlot(): Slot | undefined {
  return store.getStore();
}

export class WhatsAppSlotRefused extends Error {
  constructor(public readonly reason: 'daily_whatsapp_limit_reached' | 'plan_check_failed') {
    super(reason === 'daily_whatsapp_limit_reached' ? 'Daily WhatsApp limit reached' : 'WhatsApp limit could not be checked');
    this.name = 'WhatsAppSlotRefused';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function settle(slot: Slot, status: 'sent' | 'failed', error?: string | null): Promise<void> {
  await query(
    `UPDATE whatsapp_messages
        SET status = $2::varchar,
            message_text = COALESCE($3, message_text),
            media_url = COALESCE($4, media_url),
            baileys_message_id = COALESCE($5, baileys_message_id),
            amount_due = COALESCE($6, amount_due),
            error_message = $7,
            to_number = COALESCE($8, to_number),
            sent_at = CASE WHEN $2::varchar = 'failed' THEN NULL ELSE sent_at END
      WHERE id = ANY($1::uuid[])`,
    [
      slot.ids, status, slot.text ?? null, slot.mediaUrl ?? null, slot.providerId ?? null, slot.amountDue ?? null,
      (error ?? slot.error)?.slice(0, 500) ?? null,
      slot.to ? slot.to.replace(/@.*$/, '').slice(0, 20) : null,
    ],
  ).catch((err) => console.error('[send-slot] could not settle the reserved row:', err instanceof Error ? err.message : err));
}

export async function withWhatsAppSlot<T>(
  businessId: string,
  meta: SlotMeta,
  fn: () => Promise<T>,
  opts: { delivered?: (result: T) => boolean } = {},
): Promise<T> {
  let ids: string[];
  try {
    ids = await withLimitedCreate(
      businessId,
      [{ limitType: 'whatsapp', adding: 1 + (meta.extra?.length ?? 0) }],
      async (client) => {
        const rows: Array<{ referenceId: string | null; reminderSource: string | null; amountDue: number | null }> = [
          {
            referenceId: meta.referenceId && UUID.test(meta.referenceId) ? meta.referenceId : null,
            reminderSource: meta.reminderSource ?? null,
            amountDue: meta.amountDue ?? null,
          },
          ...(meta.extra ?? []).map((e) => ({
            referenceId: UUID.test(e.referenceId) ? e.referenceId : null,
            reminderSource: e.reminderSource ?? meta.reminderSource ?? null,
            amountDue: e.amountDue ?? null,
          })),
        ];
        const out: string[] = [];
        for (const r of rows) {
          const res = await client.query(
            `INSERT INTO whatsapp_messages
               (business_id, to_number, message_type, reference_type, reference_id, message_text, status, reminder_source, amount_due, batch_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'sending', $7, $8, $9)
             RETURNING id`,
            [
              businessId,
              meta.to.replace(/@.*$/, '').slice(0, 20) || 'unknown',
              meta.messageType.slice(0, 50),
              meta.referenceType ?? null,
              r.referenceId,
              meta.text ?? null,
              r.reminderSource,
              r.amountDue,
              meta.batchId ?? null,
            ],
          );
          out.push(res.rows[0].id as string);
        }
        return out;
      },
    );
  } catch (err) {
    if (err instanceof LimitRefusedError) {
      throw new WhatsAppSlotRefused(err.check.unavailable ? 'plan_check_failed' : 'daily_whatsapp_limit_reached');
    }
    throw err;
  }
  const slot: Slot = { id: ids[0], ids, text: meta.text ?? null, amountDue: meta.amountDue ?? null };
  let result: T;
  try {
    result = await store.run(slot, fn);
  } catch (err) {
    await settle(slot, 'failed', err instanceof Error ? err.message : String(err));
    throw err;
  }
  const ok = opts.delivered ? opts.delivered(result) : true;
  await settle(slot, ok ? 'sent' : 'failed', ok ? null : slot.error ?? 'Not delivered');
  return result;
}

/**
 * Rows left `sending` for more than 10 minutes (the process died between reserving and settling) become `failed`
 * with no send time, so they stop counting toward the daily cap. The UPDATE repeats its selecting condition.
 * Called from the frequent whatsapp-followups cron.
 */
export async function sweepStaleWhatsAppSlots(): Promise<number> {
  const res = await query(
    `UPDATE whatsapp_messages
        SET status = 'failed', sent_at = NULL, error_message = COALESCE(error_message, 'Send did not finish')
      WHERE status = 'sending' AND sent_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'`,
  );
  return res.rowCount ?? 0;
}
