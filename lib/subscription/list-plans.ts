import * as db from '@/lib/db';

/**
 * Active subscription plans with Feature/Limits registry merged into JSONB features.
 * Shared by admin, tenant, and public plan listing routes.
 */
export async function listActiveSubscriptionPlans() {
  const plans = await db.queryRows(`
    SELECT 
      id,
      name,
      display_name,
      description,
      price_monthly,
      price_yearly,
      currency,
      features,
      is_active,
      sort_order,
      created_at,
      updated_at
    FROM subscription_plans
    WHERE is_active = true
    ORDER BY sort_order ASC
  `);

  const plansWithRegistry = await Promise.all(
    plans.map(async (plan: Record<string, unknown>) => {
      const features =
        typeof plan.features === 'string'
          ? JSON.parse(plan.features)
          : (plan.features as Record<string, unknown>) ?? {};

      try {
        const enabledFeatures = await db.query(
          `SELECT feature_id 
           FROM subscription_plan_features 
           WHERE plan_id = $1 AND enabled = true`,
          [plan.id],
        );

        if (enabledFeatures.rows.length > 0) {
          const feat = features as { features?: Record<string, boolean> };
          if (!feat.features) feat.features = {};

          enabledFeatures.rows.forEach((row: { feature_id: string }) => {
            feat.features![row.feature_id] = true;
          });
        }
      } catch (error) {
        console.warn('Feature Registry not available, using JSONB:', error);
      }

      try {
        const planLimits = await db.query(
          `SELECT limit_key, limit_value 
           FROM subscription_plan_limits 
           WHERE plan_id = $1`,
          [plan.id],
        );

        if (planLimits.rows.length > 0) {
          const feat = features as { limits?: Record<string, number> };
          if (!feat.limits) feat.limits = {};

          const jsonbKeyMap: Record<string, string> = {
            max_invoices_per_month: 'max_invoices_per_month',
            max_customers: 'max_customers',
            max_items: 'max_items',
            max_users: 'max_users',
            max_whatsapp_per_day: 'max_whatsapp_per_day',
          };

          planLimits.rows.forEach((row: { limit_key: string; limit_value: number }) => {
            const jsonbKey = jsonbKeyMap[row.limit_key] || row.limit_key;
            if (jsonbKey) {
              feat.limits![jsonbKey] = row.limit_value;
            }
          });
        }
      } catch (error) {
        console.warn('Limits Registry not available, using JSONB:', error);
      }

      return {
        ...plan,
        features,
      };
    }),
  );

  return plansWithRegistry;
}
