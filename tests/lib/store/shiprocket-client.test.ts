import {
  cityStateFromAddress,
  clearShiprocketCache,
  createShiprocketClient,
  shiprocketErrorMessage,
  type ShiprocketParcel,
} from '@/lib/store/delivery/shiprocket';

type Route = (body: Record<string, unknown> | null) => { status?: number; json: unknown };

function mockFetch(routes: Record<string, Route>) {
  const calls: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('https://apiv2.shiprocket.in/v1/external', '').split('?')[0];
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ path, body });
    const route = routes[path];
    if (!route) throw new Error(`unexpected call ${path}`);
    const { status = 200, json } = route(body);
    return { ok: status < 400, status, json: async () => json } as Response;
  });
  global.fetch = fn as unknown as typeof fetch;
  return calls;
}

const creds = { email: 'ops@shop.in', password: 'secret' };
const parcel: ShiprocketParcel = {
  ref: 'SO-101',
  buyerName: 'Asha Rao',
  buyerPhone: '919876543210',
  address: '12 MG Road, Kothrud',
  pincode: '411038',
  items: [
    { name: 'Kurta', units: 2, price: 450 },
    { name: 'Dupatta', units: 1, price: 200 },
  ],
  subTotal: 1100,
  cod: true,
  weightKg: 0.8,
};

const base: Record<string, Route> = {
  '/auth/login': () => ({ json: { token: 'tok' } }),
  '/settings/company/pickup': () => ({
    json: { data: { shipping_address: [{ pickup_location: 'Warehouse' }, { pickup_location: 'Shop', is_primary_location: 1 }] } },
  }),
  '/open/postcode/details': () => ({ json: { success: true, postcode_details: { city: 'Pune', state: 'Maharashtra' } } }),
  '/orders/create/adhoc': () => ({ json: { order_id: 5551, shipment_id: 7771, status: 'NEW' } }),
  '/courier/assign/awb': () => ({
    json: { awb_assign_status: 1, response: { data: { awb_code: '1234567890', courier_name: 'Delhivery Surface' } } },
  }),
  '/courier/generate/pickup': () => ({ json: { pickup_status: 1, response: { pickup_scheduled_date: '2026-10-04 14:00:00' } } }),
};

beforeEach(() => clearShiprocketCache());

describe('Shiprocket client', () => {
  test('books end to end: primary pickup location, city/state from PIN, real items, AWB, pickup', async () => {
    const calls = mockFetch(base);
    const result = await createShiprocketClient(creds).book(parcel);

    expect(result).toEqual({
      ok: true,
      orderId: '5551',
      shipmentId: '7771',
      awb: '1234567890',
      courierName: 'Delhivery Surface',
      trackingUrl: 'https://shiprocket.co/tracking/1234567890',
      pickupScheduledAt: '2026-10-04 14:00:00',
    });
    const create = calls.find((c) => c.path === '/orders/create/adhoc')!.body!;
    expect(create).toMatchObject({
      order_id: 'SO-101',
      pickup_location: 'Shop',
      billing_customer_name: 'Asha',
      billing_last_name: 'Rao',
      billing_city: 'Pune',
      billing_state: 'Maharashtra',
      billing_pincode: '411038',
      billing_phone: '9876543210',
      payment_method: 'COD',
      sub_total: 1100,
      weight: 0.8,
    });
    expect(create.order_items).toEqual([
      { name: 'Kurta', sku: 'SO-101-1', units: 2, selling_price: 450 },
      { name: 'Dupatta', sku: 'SO-101-2', units: 1, selling_price: 200 },
    ]);
    expect(calls.find((c) => c.path === '/courier/assign/awb')!.body).toEqual({ shipment_id: 7771 });
    expect(calls.find((c) => c.path === '/courier/generate/pickup')!.body).toEqual({ shipment_id: [7771] });
    expect(calls.filter((c) => c.path === '/auth/login')).toHaveLength(1);
  });

  test('a retry with saved ids skips order creation', async () => {
    const calls = mockFetch(base);
    const result = await createShiprocketClient(creds).book(parcel, { orderId: '5551', shipmentId: '7771' });
    expect(result.ok).toBe(true);
    expect(calls.some((c) => c.path === '/orders/create/adhoc')).toBe(false);
  });

  test('an AWB failure returns the created ids and the reason', async () => {
    mockFetch({
      ...base,
      '/courier/assign/awb': () => ({
        status: 400,
        json: { awb_assign_status: 0, response: { data: { awb_assign_error: 'Insufficient wallet balance' } } },
      }),
    });
    const result = await createShiprocketClient(creds).book(parcel);
    expect(result).toEqual({
      ok: false,
      orderId: '5551',
      shipmentId: '7771',
      stage: 'awb',
      error: 'Insufficient wallet balance',
    });
  });

  test('a pickup failure still counts as booked, with a warning', async () => {
    mockFetch({ ...base, '/courier/generate/pickup': () => ({ status: 400, json: { message: 'Pickup slot full' } }) });
    const result = await createShiprocketClient(creds).book(parcel);
    expect(result).toMatchObject({ ok: true, awb: '1234567890', stage: 'pickup', error: 'Pickup slot full', pickupScheduledAt: null });
  });

  test('no pickup address in Shiprocket stops before creating the order', async () => {
    const calls = mockFetch({ ...base, '/settings/company/pickup': () => ({ json: { data: { shipping_address: [] } } }) });
    const result = await createShiprocketClient(creds).book(parcel);
    expect(result).toMatchObject({ ok: false, stage: 'pickup_location' });
    expect(calls.some((c) => c.path === '/orders/create/adhoc')).toBe(false);
  });

  test('validation errors from Shiprocket are shown as text', async () => {
    mockFetch({
      ...base,
      '/orders/create/adhoc': () => ({ status: 422, json: { message: 'Oops', errors: { billing_phone: ['Invalid phone number'] } } }),
    });
    const result = await createShiprocketClient(creds).book(parcel);
    expect(result).toMatchObject({ ok: false, stage: 'create', error: 'Invalid phone number' });
  });

  test('falls back to the address for city/state when the PIN lookup fails', async () => {
    const calls = mockFetch({ ...base, '/open/postcode/details': () => ({ status: 404, json: {} }) });
    await createShiprocketClient(creds).book({ ...parcel, address: 'Plot 7, Sector 21, Gurugram, Haryana 122016' });
    expect(calls.find((c) => c.path === '/orders/create/adhoc')!.body).toMatchObject({
      billing_city: 'Gurugram',
      billing_state: 'Haryana',
    });
  });

  test('an expired token is refreshed once', async () => {
    let first = true;
    const calls = mockFetch({
      ...base,
      '/settings/company/pickup': () => {
        if (first) {
          first = false;
          return { status: 401, json: { message: 'Token expired' } };
        }
        return base['/settings/company/pickup'](null);
      },
    });
    const result = await createShiprocketClient(creds).book(parcel);
    expect(result.ok).toBe(true);
    expect(calls.filter((c) => c.path === '/auth/login')).toHaveLength(2);
  });

  test('label, manifest (with print fallback) and cancel', async () => {
    const calls = mockFetch({
      ...base,
      '/courier/generate/label': () => ({ json: { label_created: 1, label_url: 'https://s3/label.pdf', not_created: [] } }),
      '/manifests/generate': () => ({ status: 400, json: { message: 'Manifest already generated' } }),
      '/manifests/print': () => ({ json: { manifest_url: 'https://s3/manifest.pdf' } }),
      '/orders/cancel': () => ({ json: {} }),
    });
    const client = createShiprocketClient(creds);
    expect(await client.label(['7771'])).toBe('https://s3/label.pdf');
    expect(await client.manifest(['7771'], ['5551'])).toBe('https://s3/manifest.pdf');
    await client.cancelOrders(['5551']);
    expect(calls.find((c) => c.path === '/courier/generate/label')!.body).toEqual({ shipment_id: [7771] });
    expect(calls.find((c) => c.path === '/manifests/print')!.body).toEqual({ order_ids: [5551] });
    expect(calls.find((c) => c.path === '/orders/cancel')!.body).toEqual({ ids: [5551] });
  });
});

describe('helpers', () => {
  test('cityStateFromAddress reads the tail of an address', () => {
    expect(cityStateFromAddress('12 MG Road, Kothrud, Pune, Maharashtra 411038')).toEqual({ city: 'Pune', state: 'Maharashtra' });
    expect(cityStateFromAddress('Just one line')).toEqual({ city: null, state: null });
  });

  test('shiprocketErrorMessage prefers field errors, then AWB errors, then message', () => {
    expect(shiprocketErrorMessage({ errors: { pincode: ['Bad PIN'] }, message: 'x' }, 'f')).toBe('Bad PIN');
    expect(shiprocketErrorMessage({ response: { data: { awb_assign_error: 'No courier' } } }, 'f')).toBe('No courier');
    expect(shiprocketErrorMessage({ message: 'Plain' }, 'f')).toBe('Plain');
    expect(shiprocketErrorMessage(null, 'fallback')).toBe('fallback');
  });
});
