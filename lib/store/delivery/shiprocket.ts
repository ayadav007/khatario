import type {
  CreateShipmentInput,
  CreateShipmentResult,
  DeliveryProvider,
  DeliveryQuoteRequest,
  DeliveryQuoteResult,
} from './types';
import { parseShiprocketWebhook } from './webhooks';

interface ShiprocketCreds {
  email: string;
  password: string;
}

let cachedToken: { token: string; exp: number; email: string } | null = null;

async function login(creds: ShiprocketCreds): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() && cachedToken.email === creds.email) {
    return cachedToken.token;
  }
  const res = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string };
  if (!res.ok || !data.token) {
    throw new Error('Shiprocket login failed. Check email and API password.');
  }
  cachedToken = { token: data.token, exp: Date.now() + 8 * 60 * 60 * 1000, email: creds.email };
  return data.token;
}

async function serviceability(token: string, input: DeliveryQuoteRequest): Promise<DeliveryQuoteResult> {
  const pickup = (input.pickupPincode ?? '').replace(/\D/g, '').slice(0, 6);
  const delivery = (input.deliveryPincode ?? '').replace(/\D/g, '').slice(0, 6);
  if (pickup.length !== 6 || delivery.length !== 6) {
    return {
      serviceable: false,
      charge: 0,
      etaText: '',
      error: 'Pickup and delivery pincodes are required',
    };
  }
  const params = new URLSearchParams({
    pickup_postcode: pickup,
    delivery_postcode: delivery,
    weight: String(input.weightKg ?? 0.5),
    cod: input.isCod ? '1' : '0',
  });
  const res = await fetch(
    `https://apiv2.shiprocket.in/v1/external/courier/serviceability/?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = (await res.json().catch(() => ({}))) as {
    status?: number;
    data?: {
      available_courier_companies?: Array<{
        rate?: number;
        freight_charge?: number;
        etd?: string;
        estimated_delivery_days?: string | number;
      }>;
    };
    message?: string;
  };
  const companies = data.data?.available_courier_companies ?? [];
  if (!res.ok || companies.length === 0) {
    return {
      serviceable: false,
      charge: 0,
      etaText: '',
      error: data.message || 'No courier available for this pincode',
    };
  }
  const best = [...companies].sort(
    (a, b) => (a.rate ?? a.freight_charge ?? 0) - (b.rate ?? b.freight_charge ?? 0),
  )[0];
  const charge = Number(best.rate ?? best.freight_charge ?? 0) || 0;
  const eta =
    best.etd ||
    (best.estimated_delivery_days != null
      ? `Usually ${best.estimated_delivery_days} days`
      : 'Usually 3–7 days');
  return { serviceable: true, charge, etaText: String(eta) };
}

export function createShiprocketProvider(creds: ShiprocketCreds): DeliveryProvider {
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
        const token = await login(creds);
        return await serviceability(token, input);
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
      try {
        const token = await login(creds);
        const paymentMethod = input.paymentStatus === 'cod' ? 'COD' : 'Prepaid';
        const res = await fetch(
          'https://apiv2.shiprocket.in/v1/external/orders/create/adhoc',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              order_id: input.orderNumber,
              order_date: new Date().toISOString().slice(0, 10),
              pickup_location: 'Primary',
              billing_customer_name: input.customerName,
              billing_last_name: '',
              billing_address: input.customerAddress,
              billing_city: 'NA',
              billing_pincode: input.customerPincode || input.pickupPincode || '000000',
              billing_state: 'NA',
              billing_country: 'India',
              billing_email: input.customerEmail || 'noreply@khatario.com',
              billing_phone: input.customerPhone,
              shipping_is_billing: true,
              order_items: [
                {
                  name: `Store order ${input.orderNumber}`,
                  sku: input.orderNumber,
                  units: 1,
                  selling_price: String(input.grandTotal),
                },
              ],
              payment_method: paymentMethod,
              sub_total: input.grandTotal,
              length: 10,
              breadth: 10,
              height: 10,
              weight: input.weightKg ?? 0.5,
            }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          order_id?: number;
          shipment_id?: number;
          awb_code?: string;
          message?: string;
        };
        if (!res.ok) {
          return { ok: false, error: data.message || 'Shiprocket could not create the shipment' };
        }
        const shipmentId = String(data.shipment_id ?? data.order_id ?? '');
        const awb = data.awb_code || undefined;
        return {
          ok: true,
          shipmentId,
          awb,
          trackingUrl: awb ? `https://shiprocket.co/tracking/${awb}` : undefined,
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : 'Shiprocket request failed',
        };
      }
    },
    async cancelShipment(shipmentId: string): Promise<void> {
      const token = await login(creds);
      const numeric = Number(shipmentId);
      await fetch('https://apiv2.shiprocket.in/v1/external/orders/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ids: [Number.isFinite(numeric) ? numeric : shipmentId] }),
      });
    },
  };
}
