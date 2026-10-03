import type {
  CreateShipmentInput,
  CreateShipmentResult,
  DeliveryProvider,
  DeliveryQuoteRequest,
  DeliveryQuoteResult,
} from './types';
import { parseShiprocketWebhook } from './webhooks';

const BASE = 'https://apiv2.shiprocket.in/v1/external';

export interface ShiprocketCreds {
  email: string;
  password: string;
}

export type ShiprocketStage = 'login' | 'pickup_location' | 'create' | 'awb' | 'pickup' | 'label' | 'manifest' | 'cancel';

export class ShiprocketError extends Error {
  constructor(
    message: string,
    readonly stage: ShiprocketStage,
  ) {
    super(message);
    this.name = 'ShiprocketError';
  }
}

const tokens = new Map<string, { token: string; exp: number }>();
const pickupLocations = new Map<string, { name: string; exp: number }>();

/** Test hook: tokens and pickup locations are cached per account for the process lifetime. */
export function clearShiprocketCache(): void {
  tokens.clear();
  pickupLocations.clear();
}

async function login(creds: ShiprocketCreds): Promise<string> {
  const cached = tokens.get(creds.email);
  if (cached && cached.exp > Date.now()) return cached.token;
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string };
  if (!res.ok || !data.token) {
    throw new ShiprocketError('Shiprocket login failed. Check the API user email and password.', 'login');
  }
  // Shiprocket tokens last 10 days; refresh well before that.
  tokens.set(creds.email, { token: data.token, exp: Date.now() + 8 * 60 * 60 * 1000 });
  return data.token;
}

type Json = Record<string, unknown>;

/** Shiprocket reports problems as `message`, or as `errors: { field: [text] }`. */
export function shiprocketErrorMessage(data: unknown, fallback: string): string {
  const d = (data && typeof data === 'object' ? data : {}) as Json;
  const errors = d.errors;
  if (errors && typeof errors === 'object') {
    const first = Object.values(errors as Json).flat()[0];
    if (typeof first === 'string' && first.trim()) return first.trim();
  }
  const nested = (d.response as Json | undefined)?.data as Json | undefined;
  const awbError = nested?.awb_assign_error;
  if (typeof awbError === 'string' && awbError.trim()) return awbError.trim();
  if (typeof d.message === 'string' && d.message.trim()) return d.message.trim();
  return fallback;
}

async function call(
  creds: ShiprocketCreds,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: Json }> {
  const send = async (token: string) =>
    fetch(`${BASE}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  let res = await send(await login(creds));
  if (res.status === 401) {
    tokens.delete(creds.email);
    res = await send(await login(creds));
  }
  const data = (await res.json().catch(() => ({}))) as Json;
  return { ok: res.ok, status: res.status, data };
}

const num = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));

export interface ShiprocketParcel {
  /** Our reference, unique per parcel in the merchant's Shiprocket account. */
  ref: string;
  buyerName: string;
  buyerPhone: string;
  buyerEmail?: string | null;
  address: string;
  pincode: string;
  city?: string | null;
  state?: string | null;
  items: Array<{ name: string; sku?: string; units: number; price: number }>;
  /** Amount the courier collects (COD) or the declared value (prepaid). */
  subTotal: number;
  cod: boolean;
  weightKg: number;
  lengthCm?: number;
  breadthCm?: number;
  heightCm?: number;
}

export interface ShiprocketBooking {
  ok: boolean;
  stage?: ShiprocketStage;
  error?: string;
  orderId?: string;
  shipmentId?: string;
  awb?: string;
  courierName?: string;
  trackingUrl?: string;
  pickupScheduledAt?: string | null;
}

export const shiprocketTrackingUrl = (awb: string) => `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: 'Customer', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/** City and state from the tail of a free-text address ("…, Pune, Maharashtra 411001"). */
export function cityStateFromAddress(address: string): { city: string | null; state: string | null } {
  const parts = address
    .replace(/\b\d{6}\b/g, '')
    .split(/[,\n]/)
    .map((p) => p.replace(/[-–\s]+$/, '').trim())
    .filter(Boolean);
  if (parts.length < 2) return { city: null, state: null };
  const state = parts[parts.length - 1];
  const city = parts[parts.length - 2];
  return { city, state };
}

export function createShiprocketClient(creds: ShiprocketCreds) {
  async function pickupLocation(): Promise<string> {
    const cached = pickupLocations.get(creds.email);
    if (cached && cached.exp > Date.now()) return cached.name;
    const { ok, data } = await call(creds, '/settings/company/pickup');
    const list = (((data.data as Json | undefined)?.shipping_address ?? []) as Json[]).filter(
      (a) => typeof a.pickup_location === 'string' && a.pickup_location,
    );
    if (!ok || list.length === 0) {
      throw new ShiprocketError(
        'Add a pickup address in Shiprocket (Settings → Pickup addresses) before booking.',
        'pickup_location',
      );
    }
    const primary = list.find((a) => Number(a.is_primary_location) === 1) ?? list[0];
    const name = String(primary.pickup_location);
    pickupLocations.set(creds.email, { name, exp: Date.now() + 60 * 60 * 1000 });
    return name;
  }

  async function postcodeDetails(pincode: string): Promise<{ city: string; state: string } | null> {
    try {
      const { ok, data } = await call(creds, `/open/postcode/details?postcode=${encodeURIComponent(pincode)}`);
      const d = ((data.postcode_details ?? data.data) ?? {}) as Json;
      const city = typeof d.city === 'string' ? d.city.trim() : '';
      const state = typeof d.state === 'string' ? d.state.trim() : '';
      return ok && city && state ? { city, state } : null;
    } catch {
      return null;
    }
  }

  async function createOrder(parcel: ShiprocketParcel): Promise<{ orderId: string; shipmentId: string }> {
    const location = await pickupLocation();
    let city = parcel.city?.trim() || null;
    let state = parcel.state?.trim() || null;
    if (!city || !state) {
      const looked = await postcodeDetails(parcel.pincode);
      const parsed = cityStateFromAddress(parcel.address);
      city = city || looked?.city || parsed.city;
      state = state || looked?.state || parsed.state;
    }
    if (!city || !state) {
      throw new ShiprocketError('Could not work out the city and state for this PIN code. Add them to the address.', 'create');
    }
    const { first, last } = splitName(parcel.buyerName);
    const phone = parcel.buyerPhone.replace(/\D/g, '').slice(-10);
    const { ok, data } = await call(creds, '/orders/create/adhoc', {
      body: {
        order_id: parcel.ref,
        order_date: new Date().toISOString().slice(0, 16).replace('T', ' '),
        pickup_location: location,
        billing_customer_name: first,
        billing_last_name: last,
        billing_address: parcel.address,
        billing_city: city,
        billing_pincode: parcel.pincode,
        billing_state: state,
        billing_country: 'India',
        billing_email: parcel.buyerEmail || 'noreply@khatario.com',
        billing_phone: phone,
        shipping_is_billing: true,
        order_items: parcel.items.map((it, i) => ({
          name: it.name.slice(0, 200),
          sku: (it.sku || `${parcel.ref}-${i + 1}`).slice(0, 50),
          units: Math.max(1, Math.round(it.units)),
          selling_price: Math.max(0, Math.round(it.price * 100) / 100),
        })),
        payment_method: parcel.cod ? 'COD' : 'Prepaid',
        sub_total: Math.max(0, Math.round(parcel.subTotal * 100) / 100),
        length: parcel.lengthCm ?? 10,
        breadth: parcel.breadthCm ?? 10,
        height: parcel.heightCm ?? 10,
        weight: parcel.weightKg,
      },
    });
    const orderId = num(data.order_id);
    const shipmentId = num(data.shipment_id);
    if (!ok || !orderId || !shipmentId) {
      throw new ShiprocketError(shiprocketErrorMessage(data, 'Shiprocket could not create the order'), 'create');
    }
    return { orderId, shipmentId };
  }

  /** Without a courier id Shiprocket picks the account's recommended courier. */
  async function assignAwb(shipmentId: string, courierId?: number): Promise<{ awb: string; courierName: string }> {
    const { data } = await call(creds, '/courier/assign/awb', {
      body: { shipment_id: Number(shipmentId), ...(courierId ? { courier_id: courierId } : {}) },
    });
    const d = ((data.response as Json | undefined)?.data ?? {}) as Json;
    const awb = num(d.awb_code);
    if (Number(data.awb_assign_status) !== 1 || !awb) {
      throw new ShiprocketError(
        shiprocketErrorMessage(data, 'No courier could take this parcel. Check the PIN code and your Shiprocket wallet.'),
        'awb',
      );
    }
    return { awb, courierName: typeof d.courier_name === 'string' && d.courier_name ? d.courier_name : 'Shiprocket' };
  }

  async function requestPickup(shipmentId: string): Promise<{ scheduledAt: string | null }> {
    const { ok, data } = await call(creds, '/courier/generate/pickup', { body: { shipment_id: [Number(shipmentId)] } });
    const r = (data.response ?? {}) as Json;
    if (!ok && !/already/i.test(shiprocketErrorMessage(data, ''))) {
      throw new ShiprocketError(shiprocketErrorMessage(data, 'Pickup could not be requested'), 'pickup');
    }
    const when = typeof r.pickup_scheduled_date === 'string' ? r.pickup_scheduled_date : null;
    return { scheduledAt: when };
  }

  async function label(shipmentIds: string[]): Promise<string> {
    const { data } = await call(creds, '/courier/generate/label', { body: { shipment_id: shipmentIds.map(Number) } });
    const url = typeof data.label_url === 'string' ? data.label_url : '';
    if (Number(data.label_created) !== 1 || !url) {
      throw new ShiprocketError(shiprocketErrorMessage(data, 'Shiprocket could not create the label'), 'label');
    }
    return url;
  }

  /** Generates the manifest; when Shiprocket says it already exists, prints the existing one. */
  async function manifest(shipmentIds: string[], orderIds: string[]): Promise<string> {
    const gen = await call(creds, '/manifests/generate', { body: { shipment_id: shipmentIds.map(Number) } });
    if (typeof gen.data.manifest_url === 'string' && gen.data.manifest_url) return gen.data.manifest_url;
    const printed = await call(creds, '/manifests/print', { body: { order_ids: orderIds.map(Number) } });
    if (typeof printed.data.manifest_url === 'string' && printed.data.manifest_url) return printed.data.manifest_url;
    throw new ShiprocketError(shiprocketErrorMessage(gen.data, 'Shiprocket could not create the manifest'), 'manifest');
  }

  async function cancelOrders(orderIds: string[]): Promise<void> {
    const { ok, data } = await call(creds, '/orders/cancel', { body: { ids: orderIds.map(Number) } });
    if (!ok) throw new ShiprocketError(shiprocketErrorMessage(data, 'Shiprocket could not cancel the order'), 'cancel');
  }

  /**
   * Create the order (unless a previous attempt already did), assign a courier and AWB, then ask
   * for pickup. Ids from a partial attempt are returned so a retry never makes a second order.
   */
  async function book(
    parcel: ShiprocketParcel,
    existing: { orderId?: string | null; shipmentId?: string | null } = {},
  ): Promise<ShiprocketBooking> {
    let orderId = existing.orderId ?? undefined;
    let shipmentId = existing.shipmentId ?? undefined;
    try {
      if (!shipmentId) {
        const created = await createOrder(parcel);
        orderId = created.orderId;
        shipmentId = created.shipmentId;
      }
      const { awb, courierName } = await assignAwb(shipmentId);
      let pickupScheduledAt: string | null = null;
      let pickupError: string | undefined;
      try {
        pickupScheduledAt = (await requestPickup(shipmentId)).scheduledAt;
      } catch (e) {
        pickupError = e instanceof Error ? e.message : 'Pickup could not be requested';
      }
      return {
        ok: true,
        orderId,
        shipmentId,
        awb,
        courierName,
        trackingUrl: shiprocketTrackingUrl(awb),
        pickupScheduledAt,
        ...(pickupError ? { stage: 'pickup' as const, error: pickupError } : {}),
      };
    } catch (e) {
      return {
        ok: false,
        orderId,
        shipmentId,
        stage: e instanceof ShiprocketError ? e.stage : 'create',
        error: e instanceof Error ? e.message : 'Shiprocket request failed',
      };
    }
  }

  return { pickupLocation, postcodeDetails, createOrder, assignAwb, requestPickup, label, manifest, cancelOrders, book };
}

export type ShiprocketClient = ReturnType<typeof createShiprocketClient>;

async function serviceability(creds: ShiprocketCreds, input: DeliveryQuoteRequest): Promise<DeliveryQuoteResult> {
  const pickup = (input.pickupPincode ?? '').replace(/\D/g, '').slice(0, 6);
  const delivery = (input.deliveryPincode ?? '').replace(/\D/g, '').slice(0, 6);
  if (pickup.length !== 6 || delivery.length !== 6) {
    return { serviceable: false, charge: 0, etaText: '', error: 'Pickup and delivery pincodes are required' };
  }
  const params = new URLSearchParams({
    pickup_postcode: pickup,
    delivery_postcode: delivery,
    weight: String(input.weightKg ?? 0.5),
    cod: input.isCod ? '1' : '0',
  });
  const { ok, data } = await call(creds, `/courier/serviceability/?${params}`);
  const companies = (((data.data as Json | undefined)?.available_courier_companies ?? []) as Array<{
    rate?: number;
    freight_charge?: number;
    etd?: string;
    estimated_delivery_days?: string | number;
  }>);
  if (!ok || companies.length === 0) {
    return {
      serviceable: false,
      charge: 0,
      etaText: '',
      error: typeof data.message === 'string' && data.message ? data.message : 'No courier available for this pincode',
    };
  }
  const best = [...companies].sort((a, b) => (a.rate ?? a.freight_charge ?? 0) - (b.rate ?? b.freight_charge ?? 0))[0];
  const charge = Number(best.rate ?? best.freight_charge ?? 0) || 0;
  const eta =
    best.etd ||
    (best.estimated_delivery_days != null ? `Usually ${best.estimated_delivery_days} days` : 'Usually 3–7 days');
  return { serviceable: true, charge, etaText: String(eta) };
}

export function createShiprocketProvider(creds: ShiprocketCreds): DeliveryProvider {
  const client = createShiprocketClient(creds);
  return {
    id: 'shiprocket',
    quoteSelfFallback: true,
    parseWebhook: parseShiprocketWebhook,
    async checkServiceability(input: DeliveryQuoteRequest) {
      const q = await this.quote(input);
      return { serviceable: q.serviceable, error: q.error };
    },
    async quote(input: DeliveryQuoteRequest): Promise<DeliveryQuoteResult> {
      try {
        return await serviceability(creds, input);
      } catch (e) {
        return {
          serviceable: false,
          charge: 0,
          etaText: '',
          error: e instanceof Error ? e.message : 'Shiprocket quote failed',
        };
      }
    },
    async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
      const booked = await client.book({
        ref: input.orderNumber,
        buyerName: input.customerName,
        buyerPhone: input.customerPhone,
        buyerEmail: input.customerEmail,
        address: input.customerAddress,
        pincode: input.customerPincode,
        items: [{ name: `Order ${input.orderNumber}`, units: 1, price: input.grandTotal }],
        subTotal: input.grandTotal,
        cod: input.paymentStatus === 'cod',
        weightKg: input.weightKg ?? 0.5,
      });
      return booked.ok
        ? { ok: true, shipmentId: booked.shipmentId, awb: booked.awb, trackingUrl: booked.trackingUrl }
        : { ok: false, shipmentId: booked.shipmentId, error: booked.error };
    },
    /** Shiprocket cancels by its order id, not the shipment id. */
    async cancelShipment(carrierOrderId: string): Promise<void> {
      await client.cancelOrders([carrierOrderId]);
    },
  };
}
