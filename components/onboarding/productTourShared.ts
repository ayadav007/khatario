/** Dispatched by ProductTour; Sidebar listens and opens matching collapsible sections */
export const PRODUCT_TOUR_EXPAND_EVENT = 'khatario-tour:expand' as const;

/** Sidebar / Help: start the guided sidebar tour without URL params (works after tour completed) */
export const PRODUCT_TOUR_START_EVENT = 'khatario-product-tour:start' as const;

/**
 * Survives navigation: when starting the sidebar tour from a /settings/* page we first go to /dashboard.
 * If "1", after the sidebar tour finishes we open Business Profile with `?business_profile_tour=start`.
 */
export const PRODUCT_TOUR_CHAIN_PROFILE_SESSION_KEY = 'khatario_chain_business_profile_tour' as const;

export function expandProductTourSidebarSections(labels: string[]): void {
  if (typeof window === 'undefined' || !labels.length) return;
  window.dispatchEvent(
    new CustomEvent(PRODUCT_TOUR_EXPAND_EVENT, { detail: { labels } })
  );
}
