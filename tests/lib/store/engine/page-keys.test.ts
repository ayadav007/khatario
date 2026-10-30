import { PAGE_HANDLE_RE, pageHandle, pageKey } from '@/lib/store/engine/shared';
import * as sanitize from '@/lib/store/engine/sanitize';

describe('page keys', () => {
  it('reads the handle of a valid page key', () => {
    expect(pageHandle('page.about-us')).toBe('about-us');
  });
  it('rejects reserved, malformed and non-page keys', () => {
    expect(pageHandle('page.cart')).toBeNull();
    expect(pageHandle('page.-x')).toBeNull();
    expect(pageHandle('home')).toBeNull();
  });
  it('builds a page key', () => {
    expect(pageKey('sale')).toBe('page.sale');
  });
  it('sanitize re-exports the shared handle regex', () => {
    expect(sanitize.PAGE_HANDLE_RE).toBe(PAGE_HANDLE_RE);
  });
});
