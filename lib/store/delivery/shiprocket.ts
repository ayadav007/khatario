import { createHash } from 'crypto';
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

export type ShiprocketStage =
  | 'login'
  | 'pickup_location'
  | 'create'
  | 'awb'
  | 'pickup'
  | 'label'
  | 'manifest'
  | 'cancel'
  | 'ndr'
  | 'return_create'
  | 'return_awb';

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
const pickupLocations = new Map<string, { location: Record<string, unknown>; exp: number }>();

/**
 * Cache key for one set of credentials. Two businesses may configure the same Shiprocket email,
 * so the key covers the password too: a wrong password never reuses a token (or pickup address)
 * obtained with the right one. The password itself is not kept in the key.
 */
function credentialKey(creds: ShiprocketCreds): string {
  return createHash('sha256').update(`${creds.email.trim().toLowerCase()}\n${creds.password}`).digest('hex');
}

/** Test hook: tokens and pickup locations are cached per account for the process lifetime. */
export function clearShiprocketCache(): void {
  tokens.clear();
  pickupLocations.clear();
}

async function login(creds: ShiprocketCreds): Promise<string> {
  const cached = tokens.get(credentialKey(creds));
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
  tokens.set(credentialKey(creds), { token: data.token, exp: Date.now() + 8 * 60 * 60 * 1000 });
  return data.token;
}

/**
 * Checks a login without touching the token cache, so a connect or change of password always
 * reaches Shiprocket. 4xx or a 2xx without a token means the login was refused; anything else
 * (5xx, network failure, timeout) means Shiprocket could not be reached.
 */
export async function verifyShiprocketLogin(
  creds: ShiprocketCreds,
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: true } | { ok: false; reason: 'rejected' | 'unreachable' }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: creds.email, password: creds.password }),
      signal: controller.signal,
    });
    if (res.status >= 500) return { ok: false, reason: 'unreachable' };
    const data = (await res.json().catch(() => ({}))) as { token?: string };
    if (res.ok && data.token) return { ok: true };
    return { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
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
    tokens.delete(credentialKey(creds));
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

/** Where a returned parcel goes: the account's primary pickup address. */
export interface ShiprocketWarehouse {
  name: string;
  address: string;
  address2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
}

/** A parcel coming back from the customer to the shop. Prices are per unit and include GST. */
export interface ShiprocketReturnParcel {
  /** Our reference, e.g. RET-0001; unique per Shiprocket order in the merchant's account. */
  ref: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  address: string;
  pincode: string;
  city?: string | null;
  state?: string | null;
  items: Array<{ name: string; sku?: string; units: number; price: number; reason?: string }>;
  subTotal: number;
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

/** Last 10 digits of a phone number (drops +91, 91 and spaces), or null when there are fewer than 10. */
export function tenDigitPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
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
  /** The account's primary pickup address (the first one when none is primary), cached for an hour. */
  async function primaryLocation(): Promise<Json> {
    const cached = pickupLocations.get(credentialKey(creds));
    if (cached && cached.exp > Date.now()) return cached.location;
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
    pickupLocations.set(credentialKey(creds), { location: primary, exp: Date.now() + 60 * 60 * 1000 });
    return primary;
  }

  async function pickupLocation(): Promise<string> {
    return String((await primaryLocation()).pickup_location);
  }

  /** The primary pickup address in full: where a returned parcel is sent. */
  async function warehouseAddress(): Promise<ShiprocketWarehouse> {
    const l = await primaryLocation();
    const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
    return {
      name: text(l.name) || text(l.pickup_location),
      address: text(l.address),
      address2: text(l.address_2),
      city: text(l.city),
      state: text(l.state),
      pincode: text(l.pin_code),
      phone: text(l.phone),
      email: text(l.email),
    };
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

  /** The given city and state, else the PIN code lookup, else the tail of the address. */
  async function resolveCityState(
    p: { city?: string | null; state?: string | null; pincode: string; address: string },
    stage: ShiprocketStage,
  ): Promise<{ city: string; state: string }> {
    let city = p.city?.trim() || null;
    let state = p.state?.trim() || null;
    if (!city || !state) {
      const looked = await postcodeDetails(p.pincode);
      const parsed = cityStateFromAddress(p.address);
      city = city || looked?.city || parsed.city;
      state = state || looked?.state || parsed.state;
    }
    if (!city || !state) {
      throw new ShiprocketError('Could not work out the city and state for this PIN code. Add them to the address.', stage);
    }
    return { city, state };
  }

  async function createOrder(parcel: ShiprocketParcel): Promise<{ orderId: string; shipmentId: string }> {
    const location = await pickupLocation();
    const { city, state } = await resolveCityState(parcel, 'create');
    const { first, last } = splitName(parcel.buyerName);
    const phone = tenDigitPhone(parcel.buyerPhone);
    if (!phone) throw new ShiprocketError('A 10-digit phone number is needed to book a pickup.', 'create');
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

  /** Return order: the customer is the pickup point and the shop's primary pickup address is where it ships to. */
  async function createReturnOrder(p: ShiprocketReturnParcel): Promise<{ orderId: string; shipmentId: string }> {
    const warehouse = await warehouseAddress();
    const { city, state } = await resolveCityState(p, 'return_create');
    const { first, last } = splitName(p.customerName);
    const phone = tenDigitPhone(p.customerPhone);
    if (!phone) throw new ShiprocketError('A 10-digit phone number is needed to book a pickup.', 'return_create');
    const { ok, data } = await call(creds, '/orders/create/return', {
      body: {
        order_id: p.ref,
        order_date: new Date().toISOString().slice(0, 16).replace('T', ' '),
        pickup_customer_name: first,
        pickup_last_name: last,
        pickup_address: p.address,
        pickup_city: city,
        pickup_state: state,
        pickup_country: 'India',
        pickup_pincode: p.pincode,
        pickup_email: p.customerEmail || 'noreply@khatario.com',
        pickup_phone: phone,
        shipping_customer_name: warehouse.name,
        shipping_address: [warehouse.address, warehouse.address2].filter(Boolean).join(', '),
        shipping_city: warehouse.city,
        shipping_state: warehouse.state,
        shipping_country: 'India',
        shipping_pincode: warehouse.pincode,
        shipping_phone: tenDigitPhone(warehouse.phone) ?? warehouse.phone,
        shipping_email: warehouse.email || 'noreply@khatario.com',
        order_items: p.items.map((it, i) => ({
          name: it.name.slice(0, 200),
          sku: (it.sku || `${p.ref}-${i + 1}`).slice(0, 50),
          units: Math.max(1, Math.round(it.units)),
          selling_price: Math.max(0, Math.round(it.price * 100) / 100),
          return_reason: (it.reason || 'Return').slice(0, 200),
        })),
        payment_method: 'Prepaid',
        sub_total: Math.max(0, Math.round(p.subTotal * 100) / 100),
        length: p.lengthCm ?? 10,
        breadth: p.breadthCm ?? 10,
        height: p.heightCm ?? 10,
        weight: p.weightKg,
      },
    });
    const orderId = num(data.order_id);
    const shipmentId = num(data.shipment_id);
    if (!ok || !orderId || !shipmentId) {
      throw new ShiprocketError(shiprocketErrorMessage(data, 'Shiprocket could not create the return order'), 'return_create');
    }
    return { orderId, shipmentId };
  }

  async function assignCourierAwb(
    shipmentId: string,
    extra: Record<string, unknown>,
    stage: ShiprocketStage,
  ): Promise<{ awb: string; courierName: string }> {
    const { data } = await call(creds, '/courier/assign/awb', { body: { shipment_id: Number(shipmentId), ...extra } });
    const d = ((data.response as Json | undefined)?.data ?? {}) as Json;
    const awb = num(d.awb_code);
    if (Number(data.awb_assign_status) !== 1 || !awb) {
      throw new ShiprocketError(
        shiprocketErrorMessage(data, 'No courier could take this parcel. Check the PIN code and your Shiprocket wallet.'),
        stage,
      );
    }
    return { awb, courierName: typeof d.courier_name === 'string' && d.courier_name ? d.courier_name : 'Shiprocket' };
  }

  /** Without a courier id Shiprocket picks the account's recommended courier. */
  async function assignAwb(shipmentId: string, courierId?: number): Promise<{ awb: string; courierName: string }> {
    return assignCourierAwb(shipmentId, courierId ? { courier_id: courierId } : {}, 'awb');
  }

  async function assignReturnAwb(shipmentId: string): Promise<{ awb: string; courierName: string }> {
    return assignCourierAwb(shipmentId, { is_return: 1 }, 'return_awb');
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
   * Failed delivery (NDR): ask the courier to try again (optionally on a date, with a corrected
   * phone or address) or to send the parcel back to the shop.
   */
  async function ndrAction(
    awb: string,
    input: { action: 're-attempt' | 'return'; comments: string; deferredDate?: string | null; phone?: string | null; address?: string | null },
  ): Promise<void> {
    const body: Record<string, unknown> = { action: input.action, comments: input.comments.slice(0, 250) };
    if (input.deferredDate) body.deferred_date = input.deferredDate;
    if (input.phone) body.phone = input.phone;
    if (input.address) body.address1 = input.address.slice(0, 250);
    const { ok, data } = await call(creds, `/ndr/${encodeURIComponent(awb)}/action`, { body });
    if (!ok) throw new ShiprocketError(shiprocketErrorMessage(data, 'Shiprocket did not accept the instruction'), 'ndr');
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

  /**
   * Same contract as `book` for a return: create the return order (unless a previous attempt did),
   * assign the AWB, then ask for pickup. Ids from a partial attempt are returned so a retry never
   * makes a second Shiprocket order; a pickup failure is a warning on a booked return.
   */
  async function bookReturn(
    parcel: ShiprocketReturnParcel,
    existing: { orderId?: string | null; shipmentId?: string | null } = {},
  ): Promise<ShiprocketBooking> {
    let orderId = existing.orderId ?? undefined;
    let shipmentId = existing.shipmentId ?? undefined;
    try {
      if (!shipmentId) {
        const created = await createReturnOrder(parcel);
        orderId = created.orderId;
        shipmentId = created.shipmentId;
      }
      const { awb, courierName } = await assignReturnAwb(shipmentId);
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
        stage: e instanceof ShiprocketError ? e.stage : 'return_create',
        error: e instanceof Error ? e.message : 'Shiprocket request failed',
      };
    }
  }

  return {
    pickupLocation,
    warehouseAddress,
    postcodeDetails,
    createOrder,
    assignAwb,
    requestPickup,
    label,
    manifest,
    cancelOrders,
    book,
    ndrAction,
    createReturnOrder,
    assignReturnAwb,
    bookReturn,
  };
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
  const serviceData = (data.data as Json | undefined) ?? {};
  const companies = ((serviceData.available_courier_companies ?? []) as Array<{
    courier_company_id?: number;
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
  // Shiprocket books the courier it recommends when no courier is named, so quote that one's rate.
  const recommendedId = Number(serviceData.recommended_courier_company_id);
  const cheapest = [...companies].sort((a, b) => (a.rate ?? a.freight_charge ?? 0) - (b.rate ?? b.freight_charge ?? 0))[0];
  const best = companies.find((c) => Number(c.courier_company_id) === recommendedId) ?? cheapest;
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
