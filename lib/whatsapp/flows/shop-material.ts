import {
  loadTenantCatalogSource,
  loadTenantFileSource,
  loadTenantPolicySource,
  loadTenantTextSource,
} from '@/lib/rag/ingest/tenant-sources';

const MATERIAL_MAX = 12_000;

export async function loadShopMaterial(businessId: string): Promise<string> {
  const [policy, catalog, notes, files] = await Promise.all([
    loadTenantPolicySource(businessId).catch(() => null),
    loadTenantCatalogSource(businessId).catch(() => null),
    loadTenantTextSource(businessId).catch(() => null),
    loadTenantFileSource(businessId).catch(() => null),
  ]);
  const parts: string[] = [];
  for (const d of policy?.documents ?? []) parts.push(d.body.slice(0, 2500));
  for (const d of [...(notes?.documents ?? []), ...(files?.documents ?? [])]) parts.push(d.body.slice(0, 2500));
  const items = (catalog?.documents ?? []).slice(0, 40).map((d) => d.body.split('\n').slice(0, 4).join(' | '));
  if (items.length) parts.push(`# Products\n${items.join('\n')}`);
  return parts.join('\n\n').slice(0, MATERIAL_MAX);
}
