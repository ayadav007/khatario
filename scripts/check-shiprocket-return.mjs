#!/usr/bin/env node
/**
 * Owner-run field check for Shiprocket return orders (POST /orders/create/return).
 *
 * Creates a dummy return order RET-CHECK-<timestamp> from the account's own primary pickup address
 * back to itself, prints Shiprocket's answer, then cancels it. Run it once against the Shiprocket
 * account used for staging; if Shiprocket rejects a field name, fix lib/store/delivery/shiprocket.ts
 * (createReturnOrder) to match.
 *
 *   SHIPROCKET_EMAIL=you@shop.in SHIPROCKET_PASSWORD=... node scripts/check-shiprocket-return.mjs
 *
 * Plain Node, no project imports. The password and token are never printed.
 */

const BASE = 'https://apiv2.shiprocket.in/v1/external';
const email = process.env.SHIPROCKET_EMAIL;
const password = process.env.SHIPROCKET_PASSWORD;

if (!email || !password) {
  console.error('Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in the environment, then run this again.');
  process.exit(1);
}

async function api(path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function message(data) {
  if (data && typeof data === 'object') {
    if (data.errors && typeof data.errors === 'object') {
      const first = Object.entries(data.errors)[0];
      if (first) return `${first[0]}: ${[].concat(first[1])[0]}`;
    }
    if (typeof data.message === 'string' && data.message) return data.message;
  }
  return 'no message';
}

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

const login = await api('/auth/login', null, { email, password });
if (login.status >= 400 || !login.data.token) {
  console.error(`Shiprocket login failed (HTTP ${login.status}): ${message(login.data)}`);
  process.exit(1);
}
const token = login.data.token;

const pickups = await api('/settings/company/pickup', token);
const list = (pickups.data?.data?.shipping_address ?? []).filter((a) => a.pickup_location);
if (pickups.status >= 400 || list.length === 0) {
  console.error(`Could not read the pickup addresses (HTTP ${pickups.status}): ${message(pickups.data)}`);
  process.exit(1);
}
const loc = list.find((a) => Number(a.is_primary_location) === 1) ?? list[0];
const phone = text(loc.phone).replace(/\D/g, '').slice(-10);
const address = [text(loc.address), text(loc.address_2)].filter(Boolean).join(', ');
const ref = `RET-CHECK-${Date.now()}`;

const body = {
  order_id: ref,
  order_date: new Date().toISOString().slice(0, 16).replace('T', ' '),
  // The "customer" is the shop itself, so the parcel goes from the shop back to the shop.
  pickup_customer_name: 'Return',
  pickup_last_name: 'Check',
  pickup_address: address,
  pickup_city: text(loc.city),
  pickup_state: text(loc.state),
  pickup_country: 'India',
  pickup_pincode: text(loc.pin_code),
  pickup_email: text(loc.email) || 'noreply@khatario.com',
  pickup_phone: phone,
  shipping_customer_name: text(loc.name) || text(loc.pickup_location),
  shipping_address: address,
  shipping_city: text(loc.city),
  shipping_state: text(loc.state),
  shipping_country: 'India',
  shipping_pincode: text(loc.pin_code),
  shipping_phone: phone,
  shipping_email: text(loc.email) || 'noreply@khatario.com',
  order_items: [{ name: 'Return check item', sku: `${ref}-1`, units: 1, selling_price: 100, return_reason: 'Damaged' }],
  payment_method: 'Prepaid',
  sub_total: 100,
  length: 10,
  breadth: 10,
  height: 10,
  weight: 0.5,
};

console.log(`Creating return order ${ref} ...`);
const created = await api('/orders/create/return', token, body);
const orderId = created.data.order_id;
const shipmentId = created.data.shipment_id;
console.log(`HTTP ${created.status}`);
if (orderId && shipmentId) {
  console.log(`OK  order_id=${orderId}  shipment_id=${shipmentId}`);
} else {
  console.log(`REJECTED: ${message(created.data)}`);
  console.log('Fix the field names in createReturnOrder (lib/store/delivery/shiprocket.ts) before relying on returns.');
}

if (orderId) {
  const cancelled = await api('/orders/cancel', token, { ids: [Number(orderId)] });
  console.log(`Cancel: HTTP ${cancelled.status}${cancelled.status >= 400 ? ` - ${message(cancelled.data)}` : ''}`);
}

process.exit(orderId && shipmentId ? 0 : 2);
