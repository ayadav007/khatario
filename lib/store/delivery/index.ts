import { queryOne, queryRows } from '@/lib/db';
import { decryptPaymentSecret } from '@/lib/payments/secret-encryption';
import { quoteSelfDelivery, type DeliveryMode } from './self';
import { createShiprocketProvider } from './shiprocket';
import type { DeliveryProvider, DeliveryProviderId, DeliveryQuoteResult } from './types';
import type { StoreBranch, StoreDeliveryCharge } from '@/lib/store/resolve-store';

export async function getBranchDelivery(
  businessId: string,
  branchId: string,
): Promise<{
  branch: StoreBranch;
  charges: StoreDeliveryCharge[];
  pickupPincode: string | null;
} | null> {
  const row = await queryOne<{
    id: string;
    name: string;
    location_lat: string | null;
    location_lng: string | null;
    location_address: string | null;
    delivery_mode: string;
    delivery_radius_km: number;
    serviceable_pincodes: string[];
    allow_pickup: boolean;
    delivery_row_id: string;
    pickup_pincode: string | null;
  }>(
    `SELECT
       br.id, br.name,
       sbd.id AS delivery_row_id,
       sbd.location_lat::text, sbd.location_lng::text, sbd.location_address,
       sbd.delivery_mode, sbd.delivery_radius_km,
       sbd.serviceable_pincodes, sbd.allow_pickup,
       sbd.pickup_pincode
     FROM branches br
     INNER JOIN store_branch_delivery sbd
       ON sbd.branch_id = br.id AND sbd.business_id = br.business_id
     WHERE br.business_id = $1 AND br.id = $2 AND sbd.is_active = true`,
    [businessId, branchId],
  );
  if (!row) return null;

  const chargeRows = await queryRows<{
    min_distance_km: number;
    max_distance_km: number | null;
    charge: string;
    free_above_amount: string | null;
  }>(
    `SELECT min_distance_km, max_distance_km, charge::text, free_above_amount::text
     FROM store_delivery_charges
     WHERE branch_delivery_id = $1
     ORDER BY sort_order`,
    [row.delivery_row_id],
  );

  const fromAddress = (row.location_address ?? '').match(/\b(\d{6})\b/);
  const pickupPincode = row.pickup_pincode || fromAddress?.[1] || null;

  return {
    branch: {
      id: row.id,
      name: row.name,
      location_lat: row.location_lat ? parseFloat(row.location_lat) : null,
      location_lng: row.location_lng ? parseFloat(row.location_lng) : null,
      location_address: row.location_address,
      delivery_mode: row.delivery_mode as StoreBranch['delivery_mode'],
      delivery_radius_km: row.delivery_radius_km,
      serviceable_pincodes: row.serviceable_pincodes ?? [],
      allow_pickup: row.allow_pickup,
    },
    charges: chargeRows.map((c) => ({
      min_distance_km: c.min_distance_km,
      max_distance_km: c.max_distance_km,
      charge: parseFloat(c.charge) || 0,
      free_above_amount: c.free_above_amount ? parseFloat(c.free_above_amount) : null,
    })),
    pickupPincode,
  };
}

export async function getStoreDeliveryProviderId(
  businessId: string,
): Promise<DeliveryProviderId> {
  const row = await queryOne<{ store_delivery_provider: string | null }>(
    `SELECT store_delivery_provider FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  return row?.store_delivery_provider === 'shiprocket' ? 'shiprocket' : 'self';
}

function selfProvider(): DeliveryProvider {
  return {
    id: 'self',
    quoteSelfFallback: true,
    async checkServiceability() {
      return { serviceable: true };
    },
    async quote(): Promise<DeliveryQuoteResult> {
      return { serviceable: false, charge: 0, etaText: '', error: 'Use self slabs' };
    },
    async createShipment() {
      return { ok: true, shipmentId: 'self' };
    },
  };
}

export async function resolveDeliveryProvider(
  businessId: string,
): Promise<DeliveryProvider> {
  const id = await getStoreDeliveryProviderId(businessId);
  if (id !== 'shiprocket') return selfProvider();
  const row = await queryOne<{
    store_shiprocket_email: string | null;
    store_shiprocket_password_enc: string | null;
  }>(
    `SELECT store_shiprocket_email, store_shiprocket_password_enc
     FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  if (!row?.store_shiprocket_email || !row.store_shiprocket_password_enc) {
    throw new Error('Shiprocket is not configured');
  }
  return createShiprocketProvider({
    email: row.store_shiprocket_email,
    password: decryptPaymentSecret(row.store_shiprocket_password_enc),
  });
}

export async function quoteDeliveryForBranch(input: {
  businessId: string;
  mode: DeliveryMode;
  subtotal: number;
  pincode?: string | null;
  customerLat?: number | null;
  customerLng?: number | null;
  isCod?: boolean;
  branch: StoreBranch;
  charges: StoreDeliveryCharge[];
  pickupPincode?: string | null;
}) {
  const self = quoteSelfDelivery(input);
  const providerId = await getStoreDeliveryProviderId(input.businessId);
  if (providerId !== 'shiprocket' || input.mode === 'pickup') {
    return self;
  }

  try {
    const provider = await resolveDeliveryProvider(input.businessId);
    const partner = await provider.quote({
      pickupPincode: input.pickupPincode,
      deliveryPincode: input.pincode,
      isCod: input.isCod,
      weightKg: 0.5,
    });
    if (partner.serviceable) return partner;
    if (provider.quoteSelfFallback && self.serviceable) return self;
    return partner;
  } catch {
    return self;
  }
}
