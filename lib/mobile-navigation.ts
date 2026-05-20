/**
 * Mobile shell: tab roots, back navigation, and list-page create actions (TopBar +).
 */

export const MOBILE_TAB_ROOTS = [
  '/dashboard',
  '/invoices',
  '/items',
  '/customers',
  '/more',
] as const;

export function normalizePath(pathname: string | null): string {
  if (!pathname) return '/';
  return pathname.replace(/\/$/, '') || '/';
}

export function isMobileTabRoot(pathname: string | null): boolean {
  const p = normalizePath(pathname);
  return (MOBILE_TAB_ROOTS as readonly string[]).includes(p);
}

/** True when the page should show ← back instead of the home logo. */
export function isMobileNestedRoute(pathname: string | null): boolean {
  const p = normalizePath(pathname);
  if (isMobileTabRoot(p)) return false;
  return p !== '/' && !p.startsWith('/login');
}

/** Fallback parent route when the user taps back in the TopBar. */
export function getMobileBackHref(pathname: string | null): string {
  const p = normalizePath(pathname);

  if (p.startsWith('/reports/')) {
    if (p === '/reports') return '/more';
    return '/reports';
  }

  if (p.endsWith('/new')) {
    const parent = p.slice(0, -4);
    return parent || '/dashboard';
  }

  if (p.endsWith('/edit')) {
    const parent = p.slice(0, -5);
    return parent || '/dashboard';
  }

  if (p.endsWith('/view')) {
    const parent = p.slice(0, -5);
    return parent || '/dashboard';
  }

  const segments = p.split('/').filter(Boolean);
  if (segments.length > 1) {
    segments.pop();
    return `/${segments.join('/')}`;
  }

  return '/dashboard';
}

export type MobileListCreateAction = {
  href: string;
  ariaLabel: string;
};

const LIST_CREATE_BY_PATH: Record<string, MobileListCreateAction> = {
  '/invoices': { href: '/invoices/new', ariaLabel: 'New invoice' },
  '/items': { href: '/items/new', ariaLabel: 'New item' },
  '/customers': { href: '/customers/new', ariaLabel: 'New party' },
  '/estimates': { href: '/invoices/new?type=proforma_invoice', ariaLabel: 'New estimate' },
  '/sales-orders': { href: '/sales-orders/new', ariaLabel: 'New sales order' },
  '/purchases': { href: '/purchases/new', ariaLabel: 'New purchase' },
  '/suppliers': { href: '/suppliers/new', ariaLabel: 'New supplier' },
  '/purchase-orders': { href: '/purchase-orders/new', ariaLabel: 'New purchase order' },
  '/delivery-challans': { href: '/delivery-challans/new', ariaLabel: 'New delivery challan' },
  '/credit-notes': { href: '/credit-notes/new', ariaLabel: 'New credit note' },
  '/debit-notes': { href: '/debit-notes/new', ariaLabel: 'New debit note' },
  '/inventory-adjustments': {
    href: '/inventory-adjustments/new',
    ariaLabel: 'New adjustment',
  },
};

const COMPOSER_PREFIXES = [
  '/invoices/new',
  '/purchases/new',
  '/sales-orders/new',
  '/items/new',
  '/customers/new',
  '/suppliers/new',
  '/purchase-orders/new',
  '/delivery-challans/new',
  '/credit-notes/new',
  '/debit-notes/new',
  '/inventory-adjustments/new',
] as const;

/** Routes that must use MobileDuplicatePageChrome (no in-page Back + h1 on mobile). */
export const MOBILE_COMPOSER_ROUTES = COMPOSER_PREFIXES;

/** Primary create action for module list roots — rendered as TopBar + on mobile. */
export function getMobileListCreateAction(pathname: string | null): MobileListCreateAction | null {
  const p = normalizePath(pathname);
  return LIST_CREATE_BY_PATH[p] ?? null;
}

/** Routes where global trial/subscription strips are hidden (max form space). */
export function shouldHideGlobalBanners(pathname: string | null): boolean {
  const p = normalizePath(pathname);
  if (p.includes('/whatsapp/conversations')) return true;
  return COMPOSER_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export type SubscriptionBannerPlacement = 'hidden' | 'dashboard' | 'compact';

export function getSubscriptionBannerPlacement(pathname: string | null): SubscriptionBannerPlacement {
  if (shouldHideGlobalBanners(pathname)) return 'hidden';
  const p = normalizePath(pathname);
  if (p === '/dashboard') return 'dashboard';
  return 'compact';
}
