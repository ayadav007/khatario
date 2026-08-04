import { query, queryRows } from '@/lib/db';
import {
  deriveModulesFromProductLine,
  getDefaultHomePath,
  normalizePlatformModule,
  productLineToModule,
  type PlatformModule,
} from '@/lib/platform-modules';
import { normalizeProductLine, type ProductLine } from '@/lib/product-lines';

export type BusinessPlatformContext = {
  enabledModules: PlatformModule[];
  primaryModule: PlatformModule;
  defaultHomePath: string;
};

function buildContext(
  enabled: PlatformModule[],
  primary: PlatformModule,
): BusinessPlatformContext {
  const enabledModules = enabled.length ? enabled : (['billing'] as PlatformModule[]);
  const primaryModule = enabledModules.includes(primary) ? primary : enabledModules[0];
  return {
    enabledModules,
    primaryModule,
    defaultHomePath: getDefaultHomePath({ enabledModules, primaryModule }),
  };
}

export async function getBusinessPlatformContext(
  businessId: string,
  productLineFallback?: string | null,
  primaryModuleFallback?: string | null,
): Promise<BusinessPlatformContext> {
  let businessRow: { primary_module: string | null; product_line: string | null } | null = null;
  try {
    const business = await query<{ primary_module: string | null; product_line: string | null }>(
      `SELECT primary_module, product_line FROM businesses WHERE id = $1`,
      [businessId],
    );
    businessRow = business.rows[0] ?? null;
  } catch (error: unknown) {
    console.warn('[getBusinessPlatformContext] businesses lookup failed:', error);
  }

  const productLine =
    businessRow?.product_line ?? productLineFallback ?? null;
  const primaryFallback =
    businessRow?.primary_module ?? primaryModuleFallback ?? null;

  try {
    const rows = await queryRows<{ module_key: string }>(
      `SELECT module_key FROM business_modules
       WHERE business_id = $1 AND enabled = true
       ORDER BY module_key`,
      [businessId],
    );

    if (rows.length > 0) {
      const enabled = rows
        .map((r) => normalizePlatformModule(r.module_key))
        .filter((m): m is PlatformModule => m !== null);
      const primary =
        normalizePlatformModule(primaryFallback) ||
        productLineToModule(normalizeProductLine(productLine));
      return buildContext(enabled, primary);
    }
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code !== '42P01') {
      console.warn('[getBusinessPlatformContext] business_modules lookup failed:', error);
    }
  }

  // No business_modules rows (e.g. signup seed failed) — derive from businesses.product_line
  // so HR/Connect trials are not treated as Billing-only with zero limits.
  const derived = deriveModulesFromProductLine(productLine);
  const primary =
    normalizePlatformModule(primaryFallback) ?? derived.primary;
  return buildContext(derived.enabled, primary);
}

export async function seedInitialBusinessModules(
  client: { query: typeof query },
  businessId: string,
  productLine: ProductLine,
): Promise<void> {
  const module = productLineToModule(productLine);

  await client.query(
    `UPDATE businesses SET primary_module = $2 WHERE id = $1`,
    [businessId, module],
  );

  await client.query(
    `INSERT INTO business_modules (business_id, module_key, enabled, source)
     VALUES ($1, $2, true, 'signup')
     ON CONFLICT (business_id, module_key) DO UPDATE SET
       enabled = true,
       source = EXCLUDED.source,
       enabled_at = CURRENT_TIMESTAMP`,
    [businessId, module],
  );
}

export async function enableBusinessModule(
  businessId: string,
  moduleKey: PlatformModule,
  source: 'upgrade' | 'admin' | 'signup' = 'upgrade',
): Promise<void> {
  await query(
    `INSERT INTO business_modules (business_id, module_key, enabled, source)
     VALUES ($1, $2, true, $3)
     ON CONFLICT (business_id, module_key) DO UPDATE SET
       enabled = true,
       source = EXCLUDED.source,
       enabled_at = CURRENT_TIMESTAMP`,
    [businessId, moduleKey, source],
  );
}

export function businessHasModule(
  ctx: BusinessPlatformContext,
  moduleKey: PlatformModule,
): boolean {
  return ctx.enabledModules.includes(moduleKey);
}

export async function setPrimaryBusinessModule(
  businessId: string,
  moduleKey: PlatformModule,
): Promise<BusinessPlatformContext> {
  const ctx = await getBusinessPlatformContext(businessId);
  if (!ctx.enabledModules.includes(moduleKey)) {
    throw new Error('Product must be enabled before setting it as primary.');
  }

  await query(`UPDATE businesses SET primary_module = $2 WHERE id = $1`, [
    businessId,
    moduleKey,
  ]);

  const { syncLegacySubscriptionFromPrimaryModule } = await import(
    '@/lib/subscription/sync-legacy-subscription'
  );
  await syncLegacySubscriptionFromPrimaryModule(businessId);

  return getBusinessPlatformContext(businessId);
}

export async function disableBusinessModule(
  businessId: string,
  moduleKey: PlatformModule,
): Promise<BusinessPlatformContext> {
  const ctx = await getBusinessPlatformContext(businessId);
  if (!ctx.enabledModules.includes(moduleKey)) {
    throw new Error('Product is not enabled.');
  }
  if (ctx.enabledModules.length <= 1) {
    throw new Error(
      'Cannot disable your only product. Cancel the subscription or contact support.',
    );
  }

  await query(
    `UPDATE business_modules
     SET enabled = false
     WHERE business_id = $1 AND module_key = $2`,
    [businessId, moduleKey],
  );

  if (ctx.primaryModule === moduleKey) {
    const nextPrimary = ctx.enabledModules.find((m) => m !== moduleKey);
    if (nextPrimary) {
      await setPrimaryBusinessModule(businessId, nextPrimary);
    }
  }

  const { clearSubscriptionCache } = await import('@/lib/subscription');
  const { clearModuleSubscriptionCache } = await import(
    '@/lib/subscription/module-subscriptions'
  );
  clearSubscriptionCache(businessId);
  clearModuleSubscriptionCache(businessId);

  return getBusinessPlatformContext(businessId);
}
