/**
 * Server-side checks for todo writes (POST /api/todos, PATCH /api/todos/:id), so bad input is a 400
 * instead of a Postgres enum/uuid/timestamp error surfacing as a 500.
 */
import { queryOne } from '@/lib/db';

export const TODO_PRIORITIES = ['low', 'medium', 'high'] as const;
export const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'overdue'] as const;
export const TODO_REMINDER_TYPES = ['none', 'once', 'recurring'] as const;
export const TODO_REMINDER_CHANNELS = ['in_app', 'email', 'whatsapp'] as const;
export const TODO_TITLE_MAX = 255;
export const TODO_ENTITY_TYPE_MAX = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Parses an ISO/timestamp string; null when it is not a real instant. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class TodoInputError extends Error {}

export function checkTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new TodoInputError('Title is required');
  }
  if (title.trim().length > TODO_TITLE_MAX) {
    throw new TodoInputError(`Title must be at most ${TODO_TITLE_MAX} characters`);
  }
  return title.trim();
}

export function checkOneOf<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly T[]
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new TodoInputError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function checkInstant(field: string, value: unknown): string {
  const d = parseInstant(value);
  if (!d) throw new TodoInputError(`${field} must be a valid date and time`);
  return d.toISOString();
}

export function checkChannels(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TodoInputError('reminder_channels must be a non-empty list');
  }
  for (const c of value) checkOneOf('reminder_channels', c, TODO_REMINDER_CHANNELS);
  return Array.from(new Set(value as string[]));
}

export function checkRelatedEntity(type: unknown, id: unknown): { type: string | null; id: string | null } {
  const t = type == null || type === '' ? null : type;
  const i = id == null || id === '' ? null : id;
  if (t !== null && (typeof t !== 'string' || t.length > TODO_ENTITY_TYPE_MAX)) {
    throw new TodoInputError(`related_entity_type must be at most ${TODO_ENTITY_TYPE_MAX} characters`);
  }
  if (i !== null && !isUuid(i)) {
    throw new TodoInputError('related_entity_id must be a valid id');
  }
  return { type: t as string | null, id: i as string | null };
}

/**
 * Assignee must be an active user of the same business; empty means unassigned.
 * Returns the user id or null.
 */
export async function checkAssignee(businessId: string, assignedTo: unknown): Promise<string | null> {
  if (assignedTo == null || assignedTo === '') return null;
  if (!isUuid(assignedTo)) throw new TodoInputError('assigned_to must be a user of this business');
  const user = await queryOne<{ id: string }>(
    `SELECT id FROM users WHERE id = $1 AND business_id = $2 AND is_active = true`,
    [assignedTo, businessId]
  );
  if (!user) throw new TodoInputError('assigned_to must be a user of this business');
  return user.id;
}
