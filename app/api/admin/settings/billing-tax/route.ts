import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import { getClientIp } from '@/lib/rate-limit';
import { loadTaxSettings, saveTaxSettings, TaxSettingsError, toPublicTaxSettings } from '@/lib/platform-tax';

export const dynamic = 'force-dynamic';

/** GET — GST on Khatario's own subscription charges (mode none | inclusive | exclusive, rate, seller details, invoice prefix). */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  return NextResponse.json({ settings: toPublicTaxSettings(await loadTaxSettings()) });
}

/**
 * PUT — change them. Platform super admin only. Fields left out keep their value. Switching to inclusive or
 * exclusive needs the seller's GSTIN and legal name, otherwise 400 and nothing changes. Links already
 * sent to customers keep the amounts they were created with.
 */
export async function PUT(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Send a JSON object.' }, { status: 400 });
  }

  try {
    const before = await loadTaxSettings();
    const saved = await saveTaxSettings({
      mode: body.mode,
      rate_percent: body.rate_percent,
      seller_gstin: body.seller_gstin,
      seller_legal_name: body.seller_legal_name,
      seller_address: body.seller_address,
      seller_state_code: body.seller_state_code,
      sac_code: body.sac_code,
      invoice_prefix: body.invoice_prefix,
    }, auth.admin.id);
    // Who changed it and when is also on the setting (subscription_tax_updated_by / _at). The audit entry
    // never fails a saved change.
    const pick = (t: typeof before) => ({
      mode: t.mode, rate_percent: t.ratePercent, seller_gstin: t.sellerGstin, seller_legal_name: t.sellerLegalName,
      seller_state_code: t.sellerStateCode, sac_code: t.sacCode, invoice_prefix: t.invoicePrefix,
      seller_address_changed: t.sellerAddress !== saved.sellerAddress,
    });
    try {
      await logAdminAction(
        auth.admin.id,
        'update_subscription_tax_settings',
        'platform_settings',
        'default',
        { before: pick(before), after: pick(saved) },
        getClientIp(request),
        request.headers.get('user-agent') || undefined,
      );
    } catch {
      console.error('[admin/settings/billing-tax] audit log failed');
    }
    return NextResponse.json({ settings: toPublicTaxSettings(saved) });
  } catch (error: unknown) {
    if (error instanceof TaxSettingsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[admin/settings/billing-tax] save failed');
    return NextResponse.json({ error: 'Could not save tax settings' }, { status: 500 });
  }
}
