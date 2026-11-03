import { whatsappNumber, whatsappOrderText, whatsappOrderUrl } from '@/lib/store/whatsapp-order';

describe('whatsappNumber', () => {
  it.each([
    ['https://wa.me/919845012345', '919845012345'],
    ['https://wa.me/9845012345', '919845012345'],
    ['https://api.whatsapp.com/send?phone=919845012345', '919845012345'],
    ['https://wa.me/919845012345?text=Hi', '919845012345'],
    ['https://instagram.com/x', null],
    ['', null],
    ['https://wa.me/12345', null],
    ['https://wa.me/%E0%A4%A', null],
    ['https://wa.me/100%', null],
  ])('reads the number from a WhatsApp link: %s', (input, expected) => {
    expect(whatsappNumber(input)).toBe(expected);
  });
});

const TWO_LINES = [
  { name: 'Toned milk', pack: '1 L', quantity: 2, price: 58 },
  { name: 'Basmati rice', pack: '5 kg', quantity: 1, price: 549 },
];

describe('whatsappOrderText', () => {
  it('builds the message exactly', () => {
    expect(whatsappOrderText('Sharma Stores', TWO_LINES, '560034')).toBe(
      [
        "Hi Sharma Stores, I'd like to order:",
        '2 × Toned milk (1 L) – ₹116',
        '1 × Basmati rice (5 kg) – ₹549',
        'Total: ₹665',
        'Deliver to: 560034',
      ].join('\n'),
    );
    expect(whatsappOrderText('Sharma Stores', TWO_LINES)).toBe(
      [
        "Hi Sharma Stores, I'd like to order:",
        '2 × Toned milk (1 L) – ₹116',
        '1 × Basmati rice (5 kg) – ₹549',
        'Total: ₹665',
      ].join('\n'),
    );
  });

  it('leaves the pack out when there is none and groups big amounts the Indian way', () => {
    expect(whatsappOrderText('S', [{ name: 'TV', quantity: 1, price: 123456.5 }])).toBe(
      ["Hi S, I'd like to order:", '1 × TV – ₹1,23,456.5', 'Total: ₹1,23,456.5'].join('\n'),
    );
  });

  it('ignores a pincode that is not six digits', () => {
    expect(whatsappOrderText('S', TWO_LINES, '56')).not.toContain('Deliver to');
  });

  it('cuts long carts and stays under 2000 characters', () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ name: `Item ${i + 1}`, quantity: 1, price: 10 }));
    const text = whatsappOrderText('Sharma Stores', lines, '560034');
    const rows = text.split('\n');
    expect(rows.filter((r) => r.includes(' × '))).toHaveLength(30);
    expect(rows).toContain('…and 50 more items');
    expect(rows).toContain('Total: ₹800');
    expect(rows[rows.length - 1]).toBe('Deliver to: 560034');
    expect(whatsappOrderUrl('919845012345', text).length).toBeLessThan(2000);
  });

  it('keeps an 80-line cart with packs under 2000 characters', () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ name: `Item number ${i + 1}`, pack: '1 kg', quantity: 2, price: 55 }));
    const text = whatsappOrderText('Sharma Stores', lines, '560034');
    expect(text).toMatch(/…and \d+ more items/);
    expect(whatsappOrderUrl('919845012345', text).length).toBeLessThan(2000);
    expect(text).toContain('Total: ₹8,800');
  });

  it('says "1 more item" for a single leftover line', () => {
    const lines = Array.from({ length: 31 }, (_, i) => ({ name: `I${i}`, quantity: 1, price: 1 }));
    expect(whatsappOrderText('S', lines)).toContain('…and 1 more item\n');
  });

  it('keeps the link under 2000 characters for very long Hindi names', () => {
    const lines = Array.from({ length: 30 }, () => ({ name: 'दाल'.repeat(60), pack: 'पैक'.repeat(20), quantity: 3, price: 99 }));
    const url = whatsappOrderUrl('919845012345', whatsappOrderText('दुकान'.repeat(30), lines, '560034'));
    expect(url.length).toBeLessThan(2000);
    expect(decodeURIComponent(url.split('text=')[1])).toContain('Total: ₹8,910');
  });
});

describe('whatsappOrderUrl', () => {
  it('encodes any product name', () => {
    const lines = [
      { name: 'Salt & Pepper #1 + more\nnew line', quantity: 1, price: 10 },
      { name: 'दाल', pack: '1 kg', quantity: 2, price: 5 },
    ];
    const text = whatsappOrderText('Sharma & Sons', lines, '560034');
    const url = whatsappOrderUrl('919845012345', text);
    expect(url.startsWith('https://wa.me/919845012345?text=')).toBe(true);
    expect(url).not.toMatch(/[\n\r ]/);
    const query = url.split('?')[1];
    expect(query.split('&')).toHaveLength(1);
    expect(decodeURIComponent(query.slice('text='.length))).toBe(text);
    expect(new URL(url).searchParams.get('text')).toBe(text);
  });
});
