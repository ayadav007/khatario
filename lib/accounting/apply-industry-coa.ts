import type { PoolClient } from 'pg';
import { DEFAULT_EXPENSE_CATEGORIES } from '@/lib/accounting/default-expense-categories';
import {
  resolveIndustryPacks,
  type BusinessProfile,
  type ResolvedPacks,
} from '@/lib/accounting/industry-coa';

type Queryable = Pick<PoolClient, 'query'>;

export interface IndustryCoaResult {
  packs: Array<{ key: string; label: string }>;
  accountsCreated: string[];
  categoriesCreated: string[];
  /** Pack codes already used by a different ledger in this business; their categories stay unmapped. */
  conflictingCodes: string[];
}

export async function loadBusinessProfile(client: Queryable, businessId: string): Promise<BusinessProfile | null> {
  const { rows } = await client.query<{ industry: string | null; business_type: string | null; business_model: string | null }>(
    `SELECT industry, business_type, business_model FROM businesses WHERE id = $1`,
    [businessId]
  );
  if (!rows[0]) return null;
  return { industry: rows[0].industry, businessType: rows[0].business_type, businessModel: rows[0].business_model };
}

interface ExistingAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  is_active: boolean;
}

async function existingAccounts(client: Queryable, businessId: string, codes: string[]): Promise<Map<string, ExistingAccount>> {
  const { rows } = await client.query<ExistingAccount>(
    `SELECT id, account_code, account_name, account_type, is_active
       FROM accounts WHERE business_id = $1 AND account_code = ANY($2::text[])`,
    [businessId, codes]
  );
  return new Map(rows.map((r) => [r.account_code, r]));
}

/** Which pack ledgers are missing and which codes are taken by something else. Read-only. */
export async function previewIndustryCoa(client: Queryable, businessId: string) {
  const profile = await loadBusinessProfile(client, businessId);
  if (!profile) return null;
  const resolved = resolveIndustryPacks(profile);
  const existing = await existingAccounts(client, businessId, resolved.ledgers.map((l) => l.code));
  const { rows: cats } = await client.query<{ name: string }>(
    `SELECT LOWER(name) AS name FROM expense_categories WHERE business_id = $1`,
    [businessId]
  );
  const catNames = new Set(cats.map((c) => c.name));
  return {
    profile,
    packs: resolved.packs,
    missingLedgers: resolved.ledgers.filter((l) => !existing.has(l.code)),
    conflictingCodes: resolved.ledgers.filter((l) => isConflict(existing.get(l.code), l.name, l.account_type)).map((l) => l.code),
    missingCategories: resolved.expenseCategories.filter((c) => !catNames.has(c.name.toLowerCase())),
  };
}

function isConflict(acc: ExistingAccount | undefined, name: string, type: string): boolean {
  if (!acc) return false;
  return acc.account_type !== type || acc.account_name.trim().toLowerCase() !== name.toLowerCase();
}

/**
 * Adds the industry ledgers and expense categories for the business's industry, business type
 * and business model. Idempotent; never renames, moves or deletes existing accounts. Must run
 * after the core chart exists (groups 1100-5200).
 */
export async function applyIndustryCoa(
  client: Queryable,
  businessId: string,
  resolvedOverride?: ResolvedPacks
): Promise<IndustryCoaResult> {
  const empty: IndustryCoaResult = { packs: [], accountsCreated: [], categoriesCreated: [], conflictingCodes: [] };
  let resolved = resolvedOverride;
  if (!resolved) {
    const profile = await loadBusinessProfile(client, businessId);
    if (!profile) return empty;
    resolved = resolveIndustryPacks(profile);
  }

  const { rows: groups } = await client.query<{ id: string; group_code: string }>(
    `SELECT id, group_code FROM account_groups WHERE business_id = $1`,
    [businessId]
  );
  const groupId = new Map(groups.map((g) => [g.group_code, g.id]));
  if (!groupId.has('1000')) return { ...empty, packs: resolved.packs };

  const ledgers = resolved.ledgers.filter((l) => groupId.has(l.group));
  const { rows: plCol } = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'accounts' AND column_name = 'pl_section') AS ok`
  );
  const plColumn = plCol[0]?.ok ? ', pl_section' : '';
  const plValue = plCol[0]?.ok ? ', d.section' : '';
  const { rows: inserted } = await client.query<{ account_code: string }>(
    `INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id,
                           nature, is_system, sort_order, description${plColumn})
     SELECT $1, d.code, d.name, d.type, d.group_id, d.nature, false, d.sort, d.description${plValue}
       FROM unnest($2::text[], $3::text[], $4::text[], $5::uuid[], $6::text[], $7::int[], $8::text[], $9::text[])
         AS d(code, name, type, group_id, nature, sort, section, description)
     ON CONFLICT (business_id, account_code) DO NOTHING
     RETURNING account_code`,
    [
      businessId,
      ledgers.map((l) => l.code),
      ledgers.map((l) => l.name),
      ledgers.map((l) => l.account_type),
      ledgers.map((l) => groupId.get(l.group)!),
      ledgers.map((l) => l.nature),
      ledgers.map((l) => Number(l.code) % 100),
      ledgers.map((l) => l.plSection),
      ledgers.map((l) => l.description),
    ]
  );

  const packNames = new Map(ledgers.map((l) => [l.code as string, l]));
  const lookupCodes = [
    ...new Set([
      ...DEFAULT_EXPENSE_CATEGORIES.map((c) => c[1]),
      ...resolved.expenseCategories.map((c) => c.code),
      ...ledgers.map((l) => l.code),
    ]),
  ];
  const accounts = await existingAccounts(client, businessId, lookupCodes);
  const conflictingCodes = ledgers
    .filter((l) => isConflict(accounts.get(l.code), l.name, l.account_type))
    .map((l) => l.code as string);

  const accountFor = (code: string): string | null => {
    const acc = accounts.get(code);
    if (!acc || !acc.is_active || acc.account_type !== 'expense') return null;
    const pack = packNames.get(code);
    if (pack && isConflict(acc, pack.name, pack.account_type)) return null;
    return acc.id;
  };

  const { rows: existingCats } = await client.query<{ name: string }>(
    `SELECT LOWER(name) AS name FROM expense_categories WHERE business_id = $1`,
    [businessId]
  );
  const taken = new Set(existingCats.map((c) => c.name));
  const candidates: Array<{ name: string; code: string; blocked: boolean }> = [];
  if (taken.size === 0) {
    for (const [name, code, blocked] of DEFAULT_EXPENSE_CATEGORIES) {
      candidates.push({ name, code, blocked: blocked || resolved.blocksItcByDefault });
    }
  }
  for (const c of resolved.expenseCategories) candidates.push({ name: c.name, code: c.code, blocked: c.itcBlocked });
  const categories = candidates.filter((c) => {
    const key = c.name.toLowerCase();
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  });

  const { rows: insertedCats } = await client.query<{ name: string }>(
    `INSERT INTO expense_categories (business_id, name, account_id, itc_blocked)
     SELECT $1, d.name, d.account_id, d.blocked
       FROM unnest($2::text[], $3::uuid[], $4::boolean[]) AS d(name, account_id, blocked)
     ON CONFLICT (business_id, name) DO NOTHING
     RETURNING name`,
    [businessId, categories.map((c) => c.name), categories.map((c) => accountFor(c.code)), categories.map((c) => c.blocked)]
  );

  return {
    packs: resolved.packs,
    accountsCreated: inserted.map((r) => r.account_code),
    categoriesCreated: insertedCats.map((r) => r.name),
    conflictingCodes,
  };
}
