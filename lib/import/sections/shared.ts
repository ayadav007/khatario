import { queryOne } from '@/lib/db';
import { enforceAccessErrorResponse } from '@/lib/enforce-access';
import { parsePhone } from '@/lib/import/parse-values';
import type { CreateResult, ExistingMatch, RowValues } from '@/lib/import/types';

export type SaveResult = { ok: true; table: string; id: string } | { ok: false; error: string };

/** Trimmed text, or undefined when empty (services apply their own defaults to undefined). */
export function text(values: RowValues, key: string): string | undefined {
  const v = values[key];
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

export function num(values: RowValues, key: string): number | undefined {
  const v = values[key];
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Name compared through lower case with all whitespace removed, matching NAME_SQL. */
export function compactName(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '');
}
export const NAME_SQL = `regexp_replace(lower(name), '\\s', '', 'g')`;

export function phoneKey(values: RowValues): string | null {
  const v = text(values, 'phone');
  return v ? parsePhone(v) : null;
}

/** Keys that identify one party (customer or supplier) within a file. */
export function partyKeys(values: RowValues): string[] {
  const keys: string[] = [];
  const gstin = text(values, 'gstin');
  if (gstin) keys.push(`gstin:${gstin.toUpperCase()}`);
  const phone = phoneKey(values);
  if (phone) keys.push(`phone:${phone}`);
  const name = compactName(values.name);
  if (name) keys.push(`name:${name}`);
  return keys;
}

/** Runs each lookup in order; the first row found is the match. */
export async function firstMatch(
  lookups: Array<{ matchedOn: string; value: string | null | undefined; sql: string }>,
  businessId: string
): Promise<ExistingMatch | null> {
  for (const l of lookups) {
    if (!l.value) continue;
    const row = await queryOne<{ id: string; name: string }>(l.sql, [businessId, l.value]);
    if (row) return { id: row.id, label: row.name, matchedOn: l.matchedOn };
  }
  return null;
}

/** Lookups for customers and suppliers, matching the services' own duplicate filter. */
export function findParty(table: 'customers' | 'suppliers', values: RowValues, businessId: string) {
  const scope = `SELECT id, name FROM ${table}
    WHERE business_id = $1 AND deleted_at IS NULL AND is_active = true`;
  return firstMatch(
    [
      { matchedOn: 'GSTIN', value: text(values, 'gstin')?.toUpperCase(), sql: `${scope} AND gstin IS NOT NULL AND UPPER(TRIM(gstin)) = $2 LIMIT 1` },
      { matchedOn: 'phone', value: phoneKey(values), sql: `${scope} AND phone IS NOT NULL AND TRIM(phone) IN ($2, '91' || $2) LIMIT 1` },
      { matchedOn: 'name', value: compactName(values.name), sql: `${scope} AND ${NAME_SQL} = $2 LIMIT 1` },
    ],
    businessId
  );
}

/** A service result as a row result; a duplicate the service found reads "Already exists". */
export function fromService<T extends { id: string; name?: string | null }>(
  table: string,
  r: CreateResult<T>
): SaveResult {
  if (r.ok) return { ok: true, table, id: r.record.id };
  if (r.existing) return { ok: false, error: `Already exists: ${r.existing.name ?? ''}`.trim() };
  return { ok: false, error: r.error };
}

/**
 * Runs a service call, turning its access refusal (plan, feature or limit) into a row failure.
 * Anything else the refusal wraps (an outage) is thrown: it is not a problem with the row.
 */
export async function withAccessRefusal(
  refusal: new (...args: never[]) => Error & { reason: unknown },
  label: string,
  save: () => Promise<SaveResult>
): Promise<SaveResult> {
  try {
    return await save();
  } catch (e) {
    if (!(e instanceof refusal)) throw e;
    if (!enforceAccessErrorResponse(e.reason)) throw e.reason;
    const message = e.reason instanceof Error ? e.reason.message : '';
    return { ok: false, error: message || `Your plan does not allow adding more ${label.toLowerCase()}` };
  }
}
