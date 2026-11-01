import { pendingBadgeText, reviewWhatsappLink, reviewExcerpt } from '@/lib/store/review-admin-helpers';

describe('review admin helpers', () => {
  it('badge text', () => {
    expect(pendingBadgeText(0)).toBeNull();
    expect(pendingBadgeText(null)).toBeNull();
    expect(pendingBadgeText(3)).toBe('3');
    expect(pendingBadgeText(9)).toBe('9');
    expect(pendingBadgeText(10)).toBe('9+');
  });
  it('wa.me link', () => {
    expect(reviewWhatsappLink('9876543210')).toBe('https://wa.me/919876543210');
    expect(reviewWhatsappLink('+91 98765 43210')).toBe('https://wa.me/919876543210');
    expect(reviewWhatsappLink('123')).toBeNull();
    expect(reviewWhatsappLink(null)).toBeNull();
  });
  it('excerpt', () => {
    expect(reviewExcerpt('short', 10)).toEqual({ text: 'short', truncated: false });
    expect(reviewExcerpt('abcdefghij', 5)).toEqual({ text: 'abcde...', truncated: true });
  });
});
