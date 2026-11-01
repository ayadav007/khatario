import {
  cityStateFromAddress,
  clearShiprocketCache,
  createShiprocketClient,
  createShiprocketProvider,
  shiprocketErrorMessage,
  tenDigitPhone,
  type ShiprocketParcel,
  type ShiprocketReturnParcel,
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

describe('checkout quote', () => {
  const quoteInput = { pickupPincode: '411038', deliveryPincode: '110001', weightKg: 0.5, isCod: false };
  const courier = (courier_company_id: number, rate: number, etd: string) => ({ courier_company_id, rate, etd });

  test('quote charges the recommended courier\'s rate', async () => {
    mockFetch({
      '/auth/login': () => ({ json: { token: 't' } }),
      '/courier/serviceability/': () => ({
        json: {
          data: {
            recommended_courier_company_id: 24,
            available_courier_companies: [courier(10, 60, 'Nov 5'), courier(24, 85, 'Nov 4')],
          },
        },
      }),
    });
    const result = await createShiprocketProvider(creds).quote(quoteInput);
    expect(result).toEqual({ serviceable: true, charge: 85, etaText: 'Nov 4' });
  });

  test('without a recommended courier the quote charges the cheapest rate', async () => {
    mockFetch({
      '/auth/login': () => ({ json: { token: 't' } }),
      '/courier/serviceability/': () => ({
        json: { data: { available_courier_companies: [courier(10, 60, 'Nov 5'), courier(24, 85, 'Nov 4')] } },
      }),
    });
    const result = await createShiprocketProvider(creds).quote(quoteInput);
    expect(result).toEqual({ serviceable: true, charge: 60, etaText: 'Nov 5' });
  });

  test('a recommended courier missing from the list falls back to the cheapest rate', async () => {
    mockFetch({
      '/auth/login': () => ({ json: { token: 't' } }),
      '/courier/serviceability/': () => ({
        json: {
          data: {
            recommended_courier_company_id: 99,
            available_courier_companies: [courier(10, 60, 'Nov 5'), courier(24, 85, 'Nov 4')],
          },
        },
      }),
    });
    const result = await createShiprocketProvider(creds).quote(quoteInput);
    expect(result).toEqual({ serviceable: true, charge: 60, etaText: 'Nov 5' });
  });
});

describe('Shiprocket return orders', () => {
  const returnParcel: ShiprocketReturnParcel = {
    ref: 'RET-0001',
    customerName: 'Asha Rao',
    customerPhone: '+91 98765 43210',
    address: '12 MG Road, Kothrud',
    pincode: '411038',
    items: [{ name: 'Kurta', sku: 'KU-1', units: 1, price: 531, reason: 'Damaged' }],
    subTotal: 531,
    weightKg: 0.5,
  };
  const returnRoutes: Record<string, Route> = {
    ...base,
    '/settings/company/pickup': () => ({
      json: {
        data: {
          shipping_address: [
            {
              pickup_location: 'Main',
              address: 'Shop 4, MG Road',
              address_2: '',
              city: 'Pune',
              state: 'Maharashtra',
              pin_code: 411001,
              phone: '9822000000',
              name: 'Sharma Fresh',
              email: 'shop@x.in',
              is_primary_location: 1,
            },
          ],
        },
      },
    }),
    '/orders/create/return': () => ({ json: { order_id: 77, shipment_id: 88 } }),
  };

  test('createReturnOrder sends the customer as pickup and the warehouse as shipping', async () => {
    const calls = mockFetch(returnRoutes);
    const result = await createShiprocketClient(creds).createReturnOrder(returnParcel);

    expect(result).toEqual({ orderId: '77', shipmentId: '88' });
    const body = calls.find((c) => c.path === '/orders/create/return')!.body!;
    expect(body).toMatchObject({
      order_id: 'RET-0001',
      pickup_customer_name: 'Asha',
      pickup_last_name: 'Rao',
      pickup_address: '12 MG Road, Kothrud',
      pickup_city: 'Pune',
      pickup_state: 'Maharashtra',
      pickup_pincode: '411038',
      pickup_phone: '9876543210',
      pickup_country: 'India',
      shipping_customer_name: 'Sharma Fresh',
      shipping_address: 'Shop 4, MG Road',
      shipping_pincode: '411001',
      shipping_city: 'Pune',
      shipping_state: 'Maharashtra',
      shipping_country: 'India',
      shipping_phone: '9822000000',
      shipping_email: 'shop@x.in',
      payment_method: 'Prepaid',
      sub_total: 531,
      weight: 0.5,
      length: 10,
      breadth: 10,
      height: 10,
    });
    expect((body.order_items as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: 'Kurta',
      units: 1,
      selling_price: 531,
      return_reason: 'Damaged',
    });
  });

  test('the warehouse address and the forward pickup location share one pickup-address call', async () => {
    const calls = mockFetch(returnRoutes);
    const client = createShiprocketClient(creds);
    expect(await client.pickupLocation()).toBe('Main');
    expect(await client.warehouseAddress()).toEqual({
      name: 'Sharma Fresh',
      address: 'Shop 4, MG Road',
      address2: '',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      phone: '9822000000',
      email: 'shop@x.in',
    });
    expect(calls.filter((c) => c.path === '/settings/company/pickup')).toHaveLength(1);
  });

  test('assignReturnAwb sends is_return 1', async () => {
    const calls = mockFetch({
      ...returnRoutes,
      '/courier/assign/awb': () => ({
        json: { awb_assign_status: 1, response: { data: { awb_code: 'R123', courier_name: 'Delhivery' } } },
      }),
    });
    const result = await createShiprocketClient(creds).assignReturnAwb('88');
    expect(result).toEqual({ awb: 'R123', courierName: 'Delhivery' });
    expect(calls.find((c) => c.path === '/courier/assign/awb')!.body).toEqual({ shipment_id: 88, is_return: 1 });
  });

  test('bookReturn books end to end and asks for pickup', async () => {
    mockFetch({
      ...returnRoutes,
      '/courier/assign/awb': () => ({
        json: { awb_assign_status: 1, response: { data: { awb_code: 'R123', courier_name: 'Delhivery' } } },
      }),
    });
    const result = await createShiprocketClient(creds).bookReturn(returnParcel);
    expect(result).toEqual({
      ok: true,
      orderId: '77',
      shipmentId: '88',
      awb: 'R123',
      courierName: 'Delhivery',
      trackingUrl: 'https://shiprocket.co/tracking/R123',
      pickupScheduledAt: '2026-10-04 14:00:00',
    });
  });

  test("bookReturn keeps Shiprocket's ids when the AWB step fails", async () => {
    const calls = mockFetch({
      ...returnRoutes,
      '/courier/assign/awb': () => ({ json: { awb_assign_status: 0, message: 'Wallet balance low' } }),
    });
    const client = createShiprocketClient(creds);
    const first = await client.bookReturn(returnParcel);
    expect(first).toEqual({ ok: false, stage: 'return_awb', orderId: '77', shipmentId: '88', error: 'Wallet balance low' });
    expect(calls.filter((c) => c.path === '/orders/create/return')).toHaveLength(1);

    await client.bookReturn(returnParcel, { orderId: first.orderId, shipmentId: first.shipmentId });
    expect(calls.filter((c) => c.path === '/orders/create/return')).toHaveLength(1);
    expect(calls.filter((c) => c.path === '/courier/assign/awb')).toHaveLength(2);
  });

  test('bookReturn reports a pickup failure as a warning on a booked return', async () => {
    mockFetch({
      ...returnRoutes,
      '/courier/assign/awb': () => ({
        json: { awb_assign_status: 1, response: { data: { awb_code: 'R123', courier_name: 'Delhivery' } } },
      }),
      '/courier/generate/pickup': () => ({ status: 400, json: { message: 'Pickup slot unavailable' } }),
    });
    const result = await createShiprocketClient(creds).bookReturn(returnParcel);
    expect(result).toMatchObject({ ok: true, awb: 'R123', stage: 'pickup', error: 'Pickup slot unavailable' });
  });
});

describe('tenDigitPhone', () => {
  test('keeps the last ten digits and rejects short numbers', () => {
    expect(tenDigitPhone('+91 98765 43210')).toBe('9876543210');
    expect(tenDigitPhone('919876543210')).toBe('9876543210');
    expect(tenDigitPhone('98765')).toBeNull();
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
