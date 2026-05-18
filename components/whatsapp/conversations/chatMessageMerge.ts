import type { Message } from './ChatWindow';

/** Stable dedupe key: prefer WA message_id, else row id. */
export function messageDedupeKey(m: Message): string {
  const mid = (m as { message_id?: string }).message_id;
  if (mid && String(mid).length > 0) {
    return `mid:${mid}`;
  }
  return `id:${m.id}`;
}

export function compareMessagesChronological(a: Message, b: Message): number {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (ta !== tb) {
    return ta - tb;
  }
  return String((a as { message_id?: string }).message_id || a.id).localeCompare(
    String((b as { message_id?: string }).message_id || b.id)
  );
}

/**
 * Merges `patch` into `base`. Defined fields on patch override; omits do not wipe.
 */
export function mergeMessageRow(base: Message, patch: Partial<Message> & Record<string, unknown>): Message {
  const p = patch as Message;
  const out: Message = {
    ...base,
    ...patch,
    id: p.id ?? base.id,
    message_id: (p as { message_id?: string }).message_id ?? (base as { message_id?: string }).message_id,
    message_text: p.message_text !== undefined ? p.message_text : base.message_text,
    media_url: p.media_url !== undefined ? p.media_url : base.media_url,
    status: p.status !== undefined ? p.status : base.status,
    message_type: p.message_type !== undefined ? p.message_type : base.message_type,
    direction: p.direction !== undefined ? p.direction : base.direction,
    created_at: p.created_at !== undefined ? p.created_at : base.created_at,
    sender_type: p.sender_type !== undefined ? p.sender_type : base.sender_type,
    sender_name: p.sender_name !== undefined ? p.sender_name : base.sender_name,
    sender_number: p.sender_number !== undefined ? p.sender_number : base.sender_number,
    buttons: p.buttons !== undefined ? p.buttons : base.buttons,
    reactions: p.reactions !== undefined ? p.reactions : base.reactions,
    source_timestamp:
      p.source_timestamp !== undefined ? p.source_timestamp : base.source_timestamp
  };
  return out;
}

/**
 * Dedupes by message_id (or id), merges duplicates with mergeMessageRow, then sorts chronologically.
 */
export function mergeMessageLists(existing: Message[], incoming: Message[]): Message[] {
  const map = new Map<string, Message>();

  for (const m of existing) {
    const k = messageDedupeKey(m);
    map.set(k, m);
  }

  for (const m of incoming) {
    const k = messageDedupeKey(m);
    const prev = map.get(k);
    if (prev) {
      map.set(k, mergeMessageRow(prev, m as Partial<Message> & Record<string, unknown>));
    } else {
      map.set(k, m);
    }
  }

  return Array.from(map.values()).sort(compareMessagesChronological);
}
