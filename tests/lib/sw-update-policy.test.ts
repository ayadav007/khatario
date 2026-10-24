import { decideOnControllerChange, shouldReloadOnNavigation } from '@/lib/sw-update-policy';

describe('decideOnControllerChange', () => {
  it('ignores the first install so a half-typed login form is not wiped', () => {
    expect(decideOnControllerChange({ hadControllerAtLoad: false, pathname: '/login' })).toBe('ignore');
  });

  it('reports an update when an older worker already controlled the page', () => {
    expect(decideOnControllerChange({ hadControllerAtLoad: true, pathname: '/invoices/new' })).toBe(
      'update-available'
    );
  });

  it('ignores admin pages even after an app-page start', () => {
    expect(decideOnControllerChange({ hadControllerAtLoad: true, pathname: '/admin/businesses' })).toBe('ignore');
  });
});

describe('shouldReloadOnNavigation', () => {
  it('does nothing without a pending update', () => {
    expect(
      shouldReloadOnNavigation({ updatePending: false, previousPathname: '/dashboard', pathname: '/items' })
    ).toBe(false);
  });

  it('does not reload on the initial render', () => {
    expect(shouldReloadOnNavigation({ updatePending: true, previousPathname: null, pathname: '/dashboard' })).toBe(
      false
    );
  });

  it('does not reload while the user stays on the same page', () => {
    expect(
      shouldReloadOnNavigation({ updatePending: true, previousPathname: '/invoices/new', pathname: '/invoices/new' })
    ).toBe(false);
  });

  it('applies the pending update when the user moves to another page', () => {
    expect(
      shouldReloadOnNavigation({ updatePending: true, previousPathname: '/invoices/new', pathname: '/invoices' })
    ).toBe(true);
  });

  it('never reloads into admin pages', () => {
    expect(
      shouldReloadOnNavigation({ updatePending: true, previousPathname: '/dashboard', pathname: '/admin' })
    ).toBe(false);
  });
});
