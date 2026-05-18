import { queryOne } from '@/lib/db';
import { mergePortalTheme } from '@/lib/portal-theme';
import { mergeCustomerSurfaceSettings } from './settings';
import type { PublicBusinessSurface } from './types';
import { getBusinessSubscription } from '@/lib/subscription';
import { getEffectivePlanId } from '@/lib/subscription/effective-plan';
import { slugifyPortalSegment } from './slug';

export type PortalBusinessContext = PublicBusinessSurface & {
  portal_slug: string;
};

export async function resolveBusinessByPortalSlug(
  slug: string
): Promise<PortalBusinessContext | null> {
  const normalized = slug?.trim().toLowerCase();
  if (!normalized) return null;

  const row = await queryOne<{
    business_id: string;
    business_name: string;
    logo_url: string | null;
    phone: string | null;
    email: string | null;
    portal_slug: string;
    portal_theme: unknown;
    customer_surface_settings: unknown;
  }>(
    `SELECT
       b.id AS business_id,
       b.name AS business_name,
       b.logo_url,
       b.phone,
       b.email,
       bs.portal_slug,
       bs.portal_theme,
       bs.customer_surface_settings
     FROM business_settings bs
     INNER JOIN businesses b ON b.id = bs.business_id
     WHERE lower(trim(bs.portal_slug)) = $1`,
    [normalized]
  );

  if (!row) return null;

  const surfaceSettings = mergeCustomerSurfaceSettings(row.customer_surface_settings);
  const sub = await getBusinessSubscription(row.business_id);
  const effectivePlan = sub ? getEffectivePlanId(sub) : 'free';
  const showPlatformAd =
    surfaceSettings.show_platform_ads !== false &&
    (effectivePlan === 'free' || effectivePlan === 'trial');

  return {
    id: row.business_id,
    name: row.business_name,
    logo_url: row.logo_url,
    phone: row.phone,
    email: row.email,
    portal_slug: row.portal_slug,
    portal_theme: mergePortalTheme(row.portal_theme) as unknown as Record<string, unknown>,
    surface_settings: surfaceSettings,
    show_platform_ad: showPlatformAd,
  };
}

/** Assign portal_slug if missing; returns slug. */
export async function ensureBusinessPortalSlug(
  businessId: string,
  businessName: string
): Promise<string> {
  const existing = await queryOne<{ portal_slug: string | null }>(
    `SELECT portal_slug FROM business_settings WHERE business_id = $1`,
    [businessId]
  );
  if (existing?.portal_slug?.trim()) {
    return existing.portal_slug.trim().toLowerCase();
  }

  let candidate = slugifyPortalSegment(businessName);
  for (let i = 0; i < 20; i++) {
    const trySlug = i === 0 ? candidate : `${candidate}-${i + 1}`;
    const clash = await queryOne<{ business_id: string }>(
      `SELECT business_id FROM business_settings
       WHERE lower(trim(portal_slug)) = $1 AND business_id <> $2`,
      [trySlug, businessId]
    );
    if (!clash) {
      const hasSettings = await queryOne<{ business_id: string }>(
        `SELECT business_id FROM business_settings WHERE business_id = $1`,
        [businessId]
      );
      if (hasSettings) {
        await queryOne(
          `UPDATE business_settings SET portal_slug = $2 WHERE business_id = $1`,
          [businessId, trySlug]
        );
      } else {
        await queryOne(
          `INSERT INTO business_settings (business_id, portal_slug) VALUES ($1, $2)`,
          [businessId, trySlug]
        );
      }
      return trySlug;
    }
  }
  const fallback = `${candidate}-${businessId.slice(0, 8)}`;
  await queryOne(
    `UPDATE business_settings SET portal_slug = $2 WHERE business_id = $1`,
    [businessId, fallback]
  );
  return fallback;
}
