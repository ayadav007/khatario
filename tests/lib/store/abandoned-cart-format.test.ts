import {
  agoText,
  cartWhatsappLink,
  cartWhatsappText,
  reminderStatusText,
  type CartLine,
} from '@/lib/store/abandoned-cart-format';

const line = (name: string): CartLine => ({
  item_id: 'i', variant_id: null, quantity: 1, price: 10, name, image_url: null,
});
const now = new Date('2026-10-30T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('abandoned-cart-format', () => {
  it('agoText', () => {
    expect(agoText(ago(10_000), now)).toBe('just now');
    expect(agoText(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(agoText(ago(5 * 3600_000), now)).toBe('5 h ago');
    expect(agoText(ago(50 * 3600_000), now)).toBe('2 d ago');
  });

  it('reminderStatusText', () => {
    expect(reminderStatusText(null, null, now)).toBe('Not reminded');
    expect(reminderStatusText(ago(2 * 3600_000), 'whatsapp', now)).toBe('Reminded by WhatsApp 2 h ago');
    expect(reminderStatusText(ago(2 * 3600_000), 'push', now)).toBe('Reminded by app notification 2 h ago');
    expect(reminderStatusText(ago(2 * 3600_000), 'manual', now)).toBe('Reminded by you 2 h ago');
    expect(reminderStatusText(ago(2 * 3600_000), null, now)).toBe('Reminded 2 h ago');
  });

  it('cartWhatsappLink', () => {
    expect(cartWhatsappLink('98765 43210', 'a b')).toBe('https://wa.me/919876543210?text=a%20b');
    expect(cartWhatsappLink('+91 98765 43210', 'x')).toBe('https://wa.me/919876543210?text=x');
    expect(cartWhatsappLink('123', 'x')).toBeNull();
    expect(cartWhatsappLink(null, 'x')).toBeNull();
  });

  it('cartWhatsappText with and without the cart link', () => {
    const lines = [line('Rice'), line('Ghee')];
    const withLink = cartWhatsappText('Sharma ji', lines, 'Sharma Store', 20, 'https://s.khatario.com/cart');
    expect(withLink).toBe(
      'Hi Sharma ji, you left Rice, Ghee in your cart at Sharma Store. Total ₹20.00. Finish your order here: https://s.khatario.com/cart',
    );
    const noLink = cartWhatsappText(null, lines, 'Sharma Store', 20, null);
    expect(noLink).toBe('Hi there, you left Rice, Ghee in your cart at Sharma Store. Total ₹20.00.');
  });
});
