import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { encryptPaymentSecret } from '@/lib/payments/secret-encryption';
import { sanitizeStorePromoSheet } from '@/lib/store/promo-sheet';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;

  const row = await queryOne<{
    store_subdomain: string | null;
    store_enabled: boolean;
    store_tagline: string | null;
    store_hero_image_url: string | null;
    store_min_order_amount: string | null;
  }>(
    `SELECT
       store_subdomain, store_enabled,
       store_tagline, store_hero_image_url,
       store_min_order_amount::text,
       COALESCE(store_allow_cod, true) AS store_allow_cod,
       COALESCE(store_delivery_provider, 'self') AS store_delivery_provider,
       store_theme, store_about_md, store_contact_md,
       store_shiprocket_email,
       (store_shiprocket_password_enc IS NOT NULL) AS shiprocket_configured,
       COALESCE(store_hide_khatario_badge, false) AS store_hide_khatario_badge,
       store_promo_sheet
     FROM business_settings
     WHERE business_id = $1`,
    [businessId],
  );

  return NextResponse.json({
    store_subdomain: row?.store_subdomain ?? null,
    store_enabled: row?.store_enabled ?? false,
    store_tagline: row?.store_tagline ?? null,
    store_hero_image_url: (row as { store_hero_image_url?: string | null })?.store_hero_image_url ?? null,
    store_min_order_amount: parseFloat(row?.store_min_order_amount ?? '0') || 0,
    store_allow_cod: (row as { store_allow_cod?: boolean })?.store_allow_cod !== false,
    store_delivery_provider: (row as { store_delivery_provider?: string })?.store_delivery_provider ?? 'self',
    store_theme: (row as { store_theme?: unknown })?.store_theme ?? null,
    store_about_md: (row as { store_about_md?: string | null })?.store_about_md ?? null,
    store_contact_md: (row as { store_contact_md?: string | null })?.store_contact_md ?? null,
    store_shiprocket_email: (row as { store_shiprocket_email?: string | null })?.store_shiprocket_email ?? null,
    shiprocket_configured: !!(row as { shiprocket_configured?: boolean })?.shiprocket_configured,
    store_hide_khatario_badge: !!(row as { store_hide_khatario_badge?: boolean })?.store_hide_khatario_badge,
    store_promo_sheet: sanitizeStorePromoSheet(
      (row as { store_promo_sheet?: unknown })?.store_promo_sheet,
    ),
  });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, body.business_id ?? searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;

  const {
    store_subdomain, store_enabled, store_tagline, store_hero_image_url, store_min_order_amount,
    store_allow_cod, store_delivery_provider, store_theme, store_about_md, store_contact_md,
    store_shiprocket_email, store_shiprocket_password, store_hide_khatario_badge,
    store_promo_sheet,
  } = body;

  // Validate subdomain format
  if (store_subdomain !== undefined && store_subdomain !== null) {
    const sd = String(store_subdomain).trim().toLowerCase();
    if (sd.length < 3 || sd.length > 63) {
      return NextResponse.json(
        { error: 'Store URL must be 3-63 characters' },
        { status: 400 },
      );
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(sd)) {
      return NextResponse.json(
        { error: 'Store URL must contain only lowercase letters, numbers, and hyphens' },
        { status: 400 },
      );
    }
    // Reserved subdomains
    const reserved = new Set([
      'www', 'staging', 'app', 'api', 'admin', 'mail', 'cdn',
      'assets', 'static', 'status', 'help', 'support', 'docs',
      'blog', 'dev', 'test', 'demo', 'sandbox',
    ]);
    if (reserved.has(sd)) {
      return NextResponse.json(
        { error: `"${sd}" is reserved. Choose a different store URL.` },
        { status: 400 },
      );
    }
    // Uniqueness check
    const existing = await queryOne<{ business_id: string }>(
      `SELECT business_id FROM business_settings
       WHERE lower(trim(store_subdomain)) = $1 AND business_id != $2`,
      [sd, businessId],
    );
    if (existing) {
      return NextResponse.json(
        { error: 'This store URL is already taken' },
        { status: 409 },
      );
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 0;

  if (store_subdomain !== undefined) {
    idx++;
    sets.push(`store_subdomain = $${idx}`);
    params.push(store_subdomain ? String(store_subdomain).trim().toLowerCase() : null);
  }
  if (store_enabled !== undefined) {
    idx++;
    sets.push(`store_enabled = $${idx}`);
    params.push(Boolean(store_enabled));
  }
  if (store_tagline !== undefined) {
    idx++;
    sets.push(`store_tagline = $${idx}`);
    params.push(store_tagline ?? null);
  }
  if (store_hero_image_url !== undefined) {
    idx++;
    sets.push(`store_hero_image_url = $${idx}`);
    params.push(store_hero_image_url ?? null);
  }
  if (store_min_order_amount !== undefined) {
    idx++;
    sets.push(`store_min_order_amount = $${idx}`);
    params.push(parseFloat(store_min_order_amount) || 0);
  }
  if (store_allow_cod !== undefined) {
    idx++;
    sets.push(`store_allow_cod = $${idx}`);
    params.push(Boolean(store_allow_cod));
  }
  if (store_delivery_provider !== undefined) {
    idx++;
    sets.push(`store_delivery_provider = $${idx}`);
    params.push(store_delivery_provider === 'shiprocket' ? 'shiprocket' : 'self');
  }
  if (store_theme !== undefined) {
    idx++;
    sets.push(`store_theme = $${idx}`);
    params.push(store_theme ? JSON.stringify(store_theme) : null);
  }
  if (store_about_md !== undefined) {
    idx++;
    sets.push(`store_about_md = $${idx}`);
    params.push(store_about_md ?? null);
  }
  if (store_contact_md !== undefined) {
    idx++;
    sets.push(`store_contact_md = $${idx}`);
    params.push(store_contact_md ?? null);
  }
  if (store_shiprocket_email !== undefined) {
    idx++;
    sets.push(`store_shiprocket_email = $${idx}`);
    params.push(store_shiprocket_email || null);
  }
  if (store_shiprocket_password) {
    idx++;
    sets.push(`store_shiprocket_password_enc = $${idx}`);
    params.push(encryptPaymentSecret(String(store_shiprocket_password)));
  }
  if (store_hide_khatario_badge !== undefined) {
    idx++;
    sets.push(`store_hide_khatario_badge = $${idx}`);
    params.push(Boolean(store_hide_khatario_badge));
  }
  if (store_promo_sheet !== undefined) {
    idx++;
    sets.push(`store_promo_sheet = $${idx}`);
    params.push(JSON.stringify(sanitizeStorePromoSheet(store_promo_sheet)));
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  sets.push('updated_at = CURRENT_TIMESTAMP');
  idx++;
  params.push(businessId);

  const updated = await queryOne(
    `INSERT INTO business_settings (business_id) VALUES ($${idx})
     ON CONFLICT (business_id) DO UPDATE SET ${sets.join(', ')}
     RETURNING store_subdomain, store_enabled, store_tagline,
       store_hero_image_url, store_min_order_amount::text`,
    params,
  );

  return NextResponse.json({
    store_subdomain: (updated as any)?.store_subdomain ?? null,
    store_enabled: (updated as any)?.store_enabled ?? false,
    store_tagline: (updated as any)?.store_tagline ?? null,
    store_hero_image_url: (updated as any)?.store_hero_image_url ?? null,
    store_min_order_amount: parseFloat((updated as any)?.store_min_order_amount ?? '0') || 0,
  });
}
