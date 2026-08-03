import { query, queryOne } from '@/lib/db';

export type HrOrgCatalog = {
  departments: string[];
  designations: string[];
};

export const DEFAULT_HR_ORG_CATALOG: HrOrgCatalog = {
  departments: [],
  designations: [],
};

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function parseHrOrgCatalog(raw: unknown): HrOrgCatalog {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_HR_ORG_CATALOG };
  const o = raw as Record<string, unknown>;
  return {
    departments: normalizeStringList(o.departments),
    designations: normalizeStringList(o.designations),
  };
}

async function ensureBusinessSettingsRow(businessId: string): Promise<void> {
  const existing = await queryOne(
    `SELECT business_id FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  if (!existing) {
    await query(`INSERT INTO business_settings (business_id) VALUES ($1)`, [businessId]);
  }
}

export async function getHrOrgCatalog(businessId: string): Promise<HrOrgCatalog> {
  const row = await queryOne<{ hr_org_catalog: unknown }>(
    `SELECT hr_org_catalog FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  if (!row?.hr_org_catalog) return { ...DEFAULT_HR_ORG_CATALOG };
  return parseHrOrgCatalog(row.hr_org_catalog);
}

export async function updateHrOrgCatalog(
  businessId: string,
  partial: Partial<HrOrgCatalog>,
): Promise<HrOrgCatalog> {
  const current = await getHrOrgCatalog(businessId);
  const merged: HrOrgCatalog = {
    departments:
      partial.departments !== undefined
        ? normalizeStringList(partial.departments)
        : current.departments,
    designations:
      partial.designations !== undefined
        ? normalizeStringList(partial.designations)
        : current.designations,
  };

  await ensureBusinessSettingsRow(businessId);
  await query(
    `UPDATE business_settings SET hr_org_catalog = $2::jsonb WHERE business_id = $1`,
    [businessId, JSON.stringify(merged)],
  );
  return merged;
}
