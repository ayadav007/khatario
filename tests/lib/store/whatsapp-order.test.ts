import { whatsappNumber } from '@/lib/store/whatsapp-order';

describe('whatsappNumber', () => {
  it.each([
    ['https://wa.me/919845012345', '919845012345'],
    ['https://wa.me/9845012345', '919845012345'],
    ['https://api.whatsapp.com/send?phone=919845012345', '919845012345'],
    ['https://wa.me/919845012345?text=Hi', '919845012345'],
    ['https://instagram.com/x', null],
    ['', null],
    ['https://wa.me/12345', null],
  ])('reads the number from a WhatsApp link: %s', (input, expected) => {
    expect(whatsappNumber(input)).toBe(expected);
  });
});
