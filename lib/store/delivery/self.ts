export type DeliveryMode = 'delivery' | 'pickup';

export interface DeliveryQuoteInput {
  mode: DeliveryMode;
  subtotal: number;
  pincode?: string | null;
  customerLat?: number | null;
  customerLng?: number | null;
  branch: {
    id: string;
    location_lat: number | null;
    location_lng: number | null;
    delivery_mode: 'radius' | 'pincode' | 'all_india';
    delivery_radius_km: number;
    serviceable_pincodes: string[];
    allow_pickup: boolean;
  };
  charges: Array<{
    min_distance_km: number;
    max_distance_km: number | null;
    charge: number;
    free_above_amount: number | null;
  }>;
}

export interface DeliveryQuoteResult {
  serviceable: boolean;
  charge: number;
  etaText: string;
  distanceKm: number | null;
  error?: string;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function chargeForDistance(
  km: number,
  subtotal: number,
  charges: DeliveryQuoteInput['charges'],
): number {
  const sorted = [...charges].sort((a, b) => a.min_distance_km - b.min_distance_km);
  const slab =
    sorted.find(
      (c) =>
        km >= c.min_distance_km &&
        (c.max_distance_km == null || km < c.max_distance_km),
    ) ?? sorted[sorted.length - 1];
  if (!slab) return 0;
  if (slab.free_above_amount != null && subtotal >= slab.free_above_amount) return 0;
  return slab.charge;
}

export function quoteSelfDelivery(input: DeliveryQuoteInput): DeliveryQuoteResult {
  if (input.mode === 'pickup') {
    if (!input.branch.allow_pickup) {
      return {
        serviceable: false,
        charge: 0,
        etaText: '',
        distanceKm: null,
        error: 'Pickup is not available at this location',
      };
    }
    return { serviceable: true, charge: 0, etaText: 'Ready for pickup', distanceKm: 0 };
  }

  const pin = (input.pincode ?? '').replace(/\D/g, '');
  const pins = (input.branch.serviceable_pincodes ?? []).map((p) => p.replace(/\D/g, ''));

  if (input.branch.delivery_mode === 'pincode') {
    if (!pin || !pins.includes(pin)) {
      return {
        serviceable: false,
        charge: 0,
        etaText: '',
        distanceKm: null,
        error: 'We do not deliver to this pincode',
      };
    }
    const charge = chargeForDistance(0, input.subtotal, input.charges);
    return {
      serviceable: true,
      charge,
      etaText: 'Usually 1–2 days',
      distanceKm: null,
    };
  }

  if (input.branch.delivery_mode === 'all_india') {
    const charge = chargeForDistance(0, input.subtotal, input.charges);
    return {
      serviceable: true,
      charge,
      etaText: 'Usually 3–7 days',
      distanceKm: null,
    };
  }

  // radius
  let km: number | null = null;
  if (
    input.branch.location_lat != null &&
    input.branch.location_lng != null &&
    input.customerLat != null &&
    input.customerLng != null
  ) {
    km = haversineKm(
      input.branch.location_lat,
      input.branch.location_lng,
      input.customerLat,
      input.customerLng,
    );
    if (km > input.branch.delivery_radius_km) {
      return {
        serviceable: false,
        charge: 0,
        etaText: '',
        distanceKm: km,
        error: `Delivery is limited to ${input.branch.delivery_radius_km} km`,
      };
    }
  } else if (pins.length > 0) {
    if (!pin || !pins.includes(pin)) {
      return {
        serviceable: false,
        charge: 0,
        etaText: '',
        distanceKm: null,
        error: 'We do not deliver to this pincode',
      };
    }
    km = 0;
  } else {
    km = 0;
  }

  const charge = chargeForDistance(km ?? 0, input.subtotal, input.charges);
  return {
    serviceable: true,
    charge,
    etaText: km != null && km <= 5 ? 'Usually today / next day' : 'Usually 1–2 days',
    distanceKm: km,
  };
}
