import { query, queryOne } from '@/lib/db';
import { normalizeReferralCode } from '@/lib/partners/codes';
import type { AttributionSource } from '@/lib/partners/types';

export type AttributionRow = {
  id: string;
  business_id: string;
  partner_id: string;
  source: AttributionSource;
  referral_code: string | null;
  attributed_at: string;
};

type ActivePartner = {
  id: string;
  referral_code: string;
  status: string;
};

export async function findActivePartnerByCode(rawCode: unknown): Promise<ActivePartner | null> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;
  return queryOne<ActivePartner>(
    `SELECT id, referral_code, status
     FROM platform_partners
     WHERE referral_code = $1 AND status = 'active'`,
    [code],
  );
}

export async function getBusinessAttribution(
  businessId: string,
): Promise<AttributionRow | null> {
  return queryOne<AttributionRow>(
    `SELECT id, business_id, partner_id, source, referral_code, attributed_at
     FROM business_partner_attributions WHERE business_id = $1`,
    [businessId],
  );
}

/**
 * Lock partner attribution on a business. Fails soft if already attributed
 * (returns existing). Used at trial signup and assisted claim.
 */
export async function attributeBusinessToPartner(params: {
  businessId: string;
  partnerId: string;
  source: AttributionSource;
  referralCode?: string | null;
  attributedByPartnerId?: string | null;
  attributedByAdminId?: string | null;
  notes?: string | null;
  client?: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
}): Promise<{ attribution: AttributionRow; created: boolean }> {
  const existing = await getBusinessAttribution(params.businessId);
  if (existing) {
    return { attribution: existing, created: false };
  }

  const sql = `
    INSERT INTO business_partner_attributions (
      business_id, partner_id, source, referral_code,
      attributed_by_partner_id, attributed_by_admin_id, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (business_id) DO NOTHING
    RETURNING id, business_id, partner_id, source, referral_code, attributed_at`;

  const values = [
    params.businessId,
    params.partnerId,
    params.source,
    params.referralCode ?? null,
    params.attributedByPartnerId ?? null,
    params.attributedByAdminId ?? null,
    params.notes ?? null,
  ];

  if (params.client) {
    const res = await params.client.query(sql, values);
    const row = res.rows[0] as AttributionRow | undefined;
    if (row) return { attribution: row, created: true };
    const again = await getBusinessAttribution(params.businessId);
    if (!again) throw new Error('ATTRIBUTION_FAILED');
    return { attribution: again, created: false };
  }

  const row = await queryOne<AttributionRow>(sql, values);
  if (row) return { attribution: row, created: true };
  const again = await getBusinessAttribution(params.businessId);
  if (!again) throw new Error('ATTRIBUTION_FAILED');
  return { attribution: again, created: false };
}

export async function attributeBusinessFromReferralCode(params: {
  businessId: string;
  ref: unknown;
  source?: AttributionSource;
  client?: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
}): Promise<AttributionRow | null> {
  const partner = await findActivePartnerByCode(params.ref);
  if (!partner) return null;
  const { attribution } = await attributeBusinessToPartner({
    businessId: params.businessId,
    partnerId: partner.id,
    source: params.source ?? 'ref_link',
    referralCode: partner.referral_code,
    client: params.client,
  });
  return attribution;
}

/** Partner/admin claim of an unattributed business (assisted close). */
export async function claimBusinessForPartner(params: {
  businessId: string;
  partnerId: string;
  by: 'partner' | 'admin';
  adminId?: string | null;
  notes?: string | null;
}): Promise<{ ok: true; attribution: AttributionRow; created: boolean } | { ok: false; error: string }> {
  const partner = await queryOne<{ id: string; referral_code: string; status: string }>(
    `SELECT id, referral_code, status FROM platform_partners WHERE id = $1`,
    [params.partnerId],
  );
  if (!partner || partner.status !== 'active') {
    return { ok: false, error: 'Partner is not active' };
  }

  const business = await queryOne<{ id: string }>(
    `SELECT id FROM businesses WHERE id = $1`,
    [params.businessId],
  );
  if (!business) return { ok: false, error: 'Business not found' };

  const existing = await getBusinessAttribution(params.businessId);
  if (existing) {
    if (existing.partner_id === params.partnerId) {
      return { ok: true, attribution: existing, created: false };
    }
    return { ok: false, error: 'Business is already attributed to another partner' };
  }

  const { attribution, created } = await attributeBusinessToPartner({
    businessId: params.businessId,
    partnerId: params.partnerId,
    source: params.by === 'admin' ? 'admin' : 'claim',
    referralCode: partner.referral_code,
    attributedByPartnerId: params.by === 'partner' ? params.partnerId : null,
    attributedByAdminId: params.by === 'admin' ? params.adminId ?? null : null,
    notes: params.notes,
  });

  await query(
    `UPDATE partner_deals
     SET business_id = $1, stage = CASE WHEN stage IN ('won', 'lost') THEN stage ELSE 'trial' END,
         updated_at = CURRENT_TIMESTAMP
     WHERE partner_id = $2 AND business_id IS NULL
       AND id = (
         SELECT id FROM partner_deals
         WHERE partner_id = $2 AND business_id IS NULL
         ORDER BY updated_at DESC LIMIT 1
       )`,
    [params.businessId, params.partnerId],
  ).catch(() => undefined);

  return { ok: true, attribution, created };
}
