/**
 * Turning the agent's CREATE_ORDER tag into catalogue lines: fees are dropped, names are cleaned,
 * prices always come from the catalogue and unknown names are reported instead of failing the order.
 */
const mockQueryOne = jest.fn();
jest.mock('@/lib/db', () => ({ queryOne: (...a: unknown[]) => mockQueryOne(...a) }));

import {
  cleanOrderLineName,
  isChargeLine,
  isPlaceholderName,
  parseCreateOrderTag,
  parseCustomerTag,
  resolveOrderItems,
  stripOrderTags,
} from '@/lib/ai-agent/order-items';

beforeEach(() => mockQueryOne.mockReset());

describe('customer details the agent collected', () => {
  const reply =
    'Thanks Asha! Total ₹300. CUSTOMER: {"name":" Asha  Rao ","email":"Asha@Example.com","address":"12 MG Road, Pune 411001"} CREATE_ORDER: [{"name":"Hair Oil","qty":1}]';

  it('reads name, email and address from the CUSTOMER tag', () => {
    expect(parseCustomerTag(reply)).toEqual({ name: 'Asha Rao', email: 'asha@example.com', address: '12 MG Road, Pune 411001' });
    expect(parseCreateOrderTag(reply)).toEqual([{ name: 'Hair Oil', qty: 1 }]);
  });

  it('drops values that are not a name or an email', () => {
    expect(parseCustomerTag('CUSTOMER: {"name":"9876543210","email":"not-an-email"}')).toBeNull();
    expect(parseCustomerTag('CUSTOMER: {"name":"Ravi","phone":"98"}')).toEqual({ name: 'Ravi' });
    expect(parseCustomerTag('CUSTOMER: {broken')).toBeNull();
    expect(parseCustomerTag('no tag')).toBeNull();
  });

  it('hides both tags from the customer', () => {
    expect(stripOrderTags(reply)).toBe('Thanks Asha! Total ₹300.');
  });

  it('tells made-up names from real ones', () => {
    expect(isPlaceholderName('Customer 1234')).toBe(true);
    expect(isPlaceholderName('WhatsApp customer 9876')).toBe(true);
    expect(isPlaceholderName('+91 98765 43210')).toBe(true);
    expect(isPlaceholderName('')).toBe(true);
    expect(isPlaceholderName('Asha', ['Asha'])).toBe(true);
    expect(isPlaceholderName('Asha Traders', ['Asha'])).toBe(false);
  });
});

describe('order line parsing', () => {
  it('reads the JSON array after the tag', () => {
    expect(parseCreateOrderTag('Done! CREATE_ORDER: [{"name":"Biryani Rice","qty":2}]')).toEqual([{ name: 'Biryani Rice', qty: 2 }]);
    expect(parseCreateOrderTag('no tag here')).toBeNull();
    expect(parseCreateOrderTag('CREATE_ORDER: [broken')).toBeNull();
  });

  it('strips the price the model appends to a name', () => {
    expect(cleanOrderLineName('Biryani Rice – 1kg @ ₹95')).toBe('Biryani Rice – 1kg');
    expect(cleanOrderLineName('Hair Oil ₹100')).toBe('Hair Oil');
  });

  it('recognises charge lines', () => {
    expect(isChargeLine('Delivery charge')).toBe(true);
    expect(isChargeLine('Packing fee')).toBe(true);
    expect(isChargeLine('Dal Chana')).toBe(false);
  });
});

describe('resolveOrderItems', () => {
  it('uses catalogue prices, skips fees and reports unknown names', async () => {
    mockQueryOne.mockImplementation(async (_sql: string, params: unknown[]) =>
      params[1] === 'Biryani Rice – 1kg' ? { id: 'item-1', name: 'Biryani Rice', selling_price: '95' } : null,
    );
    const res = await resolveOrderItems('biz-1', [
      { name: 'Biryani Rice – 1kg @ ₹80', qty: 2 },
      { name: 'Delivery charge', qty: 1 },
      { name: 'Unicorn Tea', qty: 1 },
    ]);
    expect(res.items).toEqual([{ item_id: 'item-1', name: 'Biryani Rice', quantity: 2, price: 95 }]);
    expect(res.unmatched).toEqual(['Unicorn Tea']);
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
    expect(mockQueryOne.mock.calls[0][1][0]).toBe('biz-1');
  });
});
