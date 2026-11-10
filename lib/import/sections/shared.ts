import { queryOne, queryRows } from '@/lib/db';
import { enforceAccessErrorResponse } from '@/lib/enforce-access';
import { parsePhone } from '@/lib/import/parse-values';
import { resolveGstinAndState } from '@/lib/tax/gstin';
import type { CreateResult, ExistingIndex, ExistingMatch, RowIssue, RowValues, SectionDefinition } from '@/lib/import/types';

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

/** The GSTIN and State must agree, as createCustomer and createSupplier require. */
export function checkGstinState(values: RowValues): RowIssue[] {
  const r = resolveGstinAndState({ gstin: text(values, 'gstin') ?? null, state: text(values, 'state') ?? null });
  return r.ok ? [] : [{ field: 'gstin', level: 'error', message: r.error }];
}

/** One value to look a row up by, named as the match is reported ('GSTIN', 'phone', ...). */
export type Lookup = { matchedOn: string; value: string | null | undefined };

/** Runs each lookup in order with its SQL; the first row found is the match. */
export async function firstMatch(
  lookups: Array<Lookup & { sql: string }>,
  businessId: string
): Promise<ExistingMatch | null> {
  for (const l of lookups) {
    if (!l.value) continue;
    const row = await queryOne<{ id: string; name: string }>(l.sql, [businessId, l.value]);
    if (row) return { id: row.id, label: row.name, matchedOn: l.matchedOn };
  }
  return null;
}

/** firstMatch against an index: the same lookups in the same order. */
export function matchIndex(index: ExistingIndex, lookups: Lookup[]): ExistingMatch | null {
  for (const l of lookups) {
    if (!l.value) continue;
    const hit = index.get(l.matchedOn)?.get(l.value);
    if (hit) return { id: hit.id, label: hit.label, matchedOn: l.matchedOn };
  }
  return null;
}

/** Files a record under each key; the first record filed under a key keeps it. */
export function addKeys(index: ExistingIndex, record: { id: string; label: string }, lookups: Lookup[]): void {
  for (const l of lookups) {
    if (!l.value) continue;
    let byKey = index.get(l.matchedOn);
    if (!byKey) index.set(l.matchedOn, (byKey = new Map()));
    if (!byKey.has(l.value)) byKey.set(l.value, record);
  }
}

export function emailKey(values: RowValues): string | null {
  return text(values, 'email')?.toLowerCase() ?? null;
}

/**
 * A row's lookups for customers and suppliers: GSTIN, phone, email (customers only, as
 * createCustomer refuses a second active customer with it), then name.
 */
export function partyLookups(table: 'customers' | 'suppliers', values: RowValues): Lookup[] {
  return [
    { matchedOn: 'GSTIN', value: text(values, 'gstin')?.toUpperCase() },
    { matchedOn: 'phone', value: phoneKey(values) },
    ...(table === 'customers' ? [{ matchedOn: 'email', value: emailKey(values) }] : []),
    { matchedOn: 'name', value: compactName(values.name) },
  ];
}

const partyScope = (table: 'customers' | 'suppliers') =>
  `FROM ${table} WHERE business_id = $1 AND deleted_at IS NULL AND is_active = true`;

/** Lookups for customers and suppliers, matching the services' own duplicate filter. */
export function findParty(table: 'customers' | 'suppliers', values: RowValues, businessId: string) {
  const scope = `SELECT id, name ${partyScope(table)}`;
  const sql: Record<string, string> = {
    GSTIN: `${scope} AND gstin IS NOT NULL AND UPPER(TRIM(gstin)) = $2 LIMIT 1`,
    phone: `${scope} AND phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') IN ($2, '91' || $2, '0' || $2) LIMIT 1`,
    email: `${scope} AND email IS NOT NULL AND lower(trim(email)) = $2 LIMIT 1`,
    name: `${scope} AND ${NAME_SQL} = $2 LIMIT 1`,
  };
  return firstMatch(
    partyLookups(table, values).map((l) => ({ ...l, sql: sql[l.matchedOn] })),
    businessId
  );
}

/**
 * Every active party with its keys computed by the same SQL expressions findParty compares.
 * A stored phone is filed under its digits and, when they start with 91 or 0, under the rest,
 * so a row's bare number finds it exactly when findParty's IN ($2, '91' || $2, '0' || $2) would.
 */
export async function loadPartyIndex(table: 'customers' | 'suppliers', businessId: string): Promise<ExistingIndex> {
  const rows = await queryRows<{ id: string; name: string; gstin: string | null; phone: string | null; email: string | null; name_key: string }>(
    `SELECT id, name, UPPER(TRIM(gstin)) AS gstin, regexp_replace(phone, '\\D', '', 'g') AS phone,
            ${table === 'customers' ? 'lower(trim(email))' : 'NULL'} AS email, ${NAME_SQL} AS name_key
       ${partyScope(table)}`,
    [businessId]
  );
  const index: ExistingIndex = new Map();
  for (const r of rows) {
    const record = { id: r.id, label: r.name };
    const d = r.phone ?? '';
    addKeys(index, record, [
      { matchedOn: 'GSTIN', value: r.gstin },
      { matchedOn: 'phone', value: d },
      { matchedOn: 'phone', value: d.startsWith('91') ? d.slice(2) : null },
      { matchedOn: 'phone', value: d.startsWith('0') ? d.slice(1) : null },
      { matchedOn: 'email', value: r.email },
      { matchedOn: 'name', value: r.name_key },
    ]);
  }
  return index;
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

/** undoRecord for one id, answered by the section's batched undoRecords. */
export function undoOne(
  undoRecords: SectionDefinition['undoRecords']
): SectionDefinition['undoRecord'] {
  return async (ctx, id) => {
    const [r] = await undoRecords(ctx, [id]);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  };
}
