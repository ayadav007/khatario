/**
 * Canonical inventory of admin /admin/plans settings (from platform_limits + platform_features).
 */
import { withDbClient } from './db';
import { ALL_LIMIT_CHECK_TYPES, LIMIT_KEY_BY_TYPE } from '../../lib/subscription/limit-registry';

export type CatalogLimit = {
  limit_key: string;
  category: string;
  label: string;
  check_limit_type: string | null;
};

export type CatalogFeature = {
  id: string;
  category: string;
  label: string;
  is_addon: boolean;
};

export async function loadPlanRegistryCatalog(): Promise<{
  limits: CatalogLimit[];
  features: CatalogFeature[];
  planIds: string[];
}> {
  return withDbClient(async (c) => {
    const keyToType = Object.fromEntries(
      Object.entries(LIMIT_KEY_BY_TYPE).map(([type, key]) => [key, type]),
    );

    const lim = await c.query<{
      limit_key: string;
      category: string;
      label: string;
    }>(
      `SELECT limit_key, category, label
       FROM platform_limits WHERE is_active = true
       ORDER BY category, sort_order`,
    );

    const feat = await c.query<{
      id: string;
      category: string;
      label: string;
      is_addon: boolean;
    }>(
      `SELECT id, category, label, COALESCE(is_addon, false) AS is_addon
       FROM platform_features WHERE is_active = true
       ORDER BY category, sort_order`,
    );

    const plans = await c.query<{ id: string }>(
      `SELECT id FROM subscription_plans WHERE is_active = true ORDER BY sort_order NULLS LAST, id`,
    );

    return {
      limits: lim.rows.map((r) => ({
        ...r,
        check_limit_type: keyToType[r.limit_key] ?? null,
      })),
      features: feat.rows,
      planIds: plans.rows.map((p) => p.id),
    };
  });
}

/** Limit types enforced by GET /api/subscriptions/check-limit */
export const ENFORCED_LIMIT_TYPES = [...ALL_LIMIT_CHECK_TYPES];
