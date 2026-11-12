import { queryOne } from '@/lib/db';
import { mergePortalTheme } from '@/lib/portal-theme';
import { getBusinessSubscription } from '@/lib/subscription';
import { getEffectivePlanId } from '@/lib/subscription/effective-plan';
import { mergeCustomerSurfaceSettings } from './settings';
import type { PublicBusinessSurface } from './types';

/** Shop header for a public customer page (logo, name, theme, platform ad), by business id. */
export async function businessSurfaceById(businessId: string): Promise<PublicBusinessSurface | null> {
  const row = await queryOne<{
    name: string;
    logo_url: string | null;
    phone: string | null;
    email: string | null;
    portal_slug: string | null;
    portal_theme: unknown;
    customer_surface_settings: unknown;
  }>(
    `SELECT b.name, b.logo_url, b.phone, b.email, bs.portal_slug, bs.portal_theme, bs.customer_surface_settings
       FROM businesses b LEFT JOIN business_settings bs ON bs.business_id = b.id
      WHERE b.id = $1`,
    [businessId],
  );
  if (!row) return null;
  const surfaceSettings = mergeCustomerSurfaceSettings(row.customer_surface_settings);
  const sub = await getBusinessSubscription(businessId, false, 'billing');
  const effectivePlan = sub ? getEffectivePlanId(sub) : 'free';
  return {
    id: businessId,
    name: row.name,
    logo_url: row.logo_url,
    phone: row.phone,
    email: row.email,
    portal_slug: row.portal_slug,
    portal_theme: mergePortalTheme(row.portal_theme) as unknown as Record<string, unknown>,
    surface_settings: surfaceSettings,
    show_platform_ad:
      surfaceSettings.show_platform_ads !== false && (effectivePlan === 'free' || effectivePlan === 'trial'),
  };
}
