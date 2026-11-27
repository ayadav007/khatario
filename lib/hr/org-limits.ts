/**
 * Plan limits for department and designation names (`max_departments`, `max_designations`).
 *
 * A name counts once per business, in any letter case, whether it is on an employee or saved in
 * Settings → departments (same rule as the registry count: `orgNamesSql`). Only a NEW name adds to the
 * count, so assigning an existing department never uses up the limit. Use the specs with
 * `withLimitedCreate` so the check and the write are one step.
 */

import type { PoolClient } from 'pg';
import { orgNamesSql } from '@/lib/subscription/limit-registry';
import type { LimitSpec } from '@/lib/subscription/limit-lock';

type Kind = 'departments' | 'designations';

const SQL_BY_KIND: Record<Kind, string> = {
  departments: orgNamesSql('department', 'departments'),
  designations: orgNamesSql('designation', 'designations'),
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** How many of `names` are not yet in use as `kind` for the business (distinct, case-insensitive). Run inside the limit lock. */
export async function countNewOrgNames(
  client: PoolClient,
  businessId: string,
  kind: Kind,
  names: unknown[],
): Promise<number> {
  const wanted = Array.from(new Set(names.map((n) => clean(n).toLowerCase()).filter(Boolean)));
  if (wanted.length === 0) return 0;
  const existing = await client.query<{ v: string }>(`SELECT v FROM (${SQL_BY_KIND[kind]}) names`, [businessId]);
  const have = new Set(existing.rows.map((r) => r.v));
  return wanted.filter((n) => !have.has(n)).length;
}

/**
 * Limit specs for writing an employee: optionally one employee slot, plus the department and
 * designation limits when the written names are new.
 */
export function employeeWriteLimitSpecs(
  businessId: string,
  input: { department?: unknown; designation?: unknown; employeeSlot: boolean },
): LimitSpec[] {
  const specs: LimitSpec[] = [];
  if (input.employeeSlot) specs.push({ limitType: 'employees' });
  if (clean(input.department)) {
    specs.push({ limitType: 'departments', adding: (c) => countNewOrgNames(c, businessId, 'departments', [input.department]) });
  }
  if (clean(input.designation)) {
    specs.push({ limitType: 'designations', adding: (c) => countNewOrgNames(c, businessId, 'designations', [input.designation]) });
  }
  return specs;
}
