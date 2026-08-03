const HERO_ID = 'landing-hero';
const HIGHLIGHT_CLASS = 'landing-hero-highlight';
const HIGHLIGHT_MS = 900;

export function scrollToLandingHero(behavior: ScrollBehavior = 'smooth') {
  document.getElementById(HERO_ID)?.scrollIntoView({ behavior, block: 'start' });
}

export function scrollToLandingPricing(behavior: ScrollBehavior = 'smooth') {
  document.getElementById('pricing')?.scrollIntoView({ behavior, block: 'start' });
}

export function pulseLandingHeroHighlight() {
  const el = document.getElementById(HERO_ID);
  if (!el) return;
  el.classList.remove(HIGHLIGHT_CLASS);
  // Force reflow so re-adding the class retriggers the animation.
  void el.offsetWidth;
  el.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
}

export function prefersReducedLandingMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** After product pick: show hero crossfade, then pricing. */
export function scrollLandingAfterProductPick(options: { sameProduct: boolean }) {
  const reduced = prefersReducedLandingMotion();
  const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';

  if (options.sameProduct) {
    scrollToLandingPricing(behavior);
    return;
  }

  scrollToLandingHero(behavior);
  pulseLandingHeroHighlight();
  window.setTimeout(
    () => scrollToLandingPricing(behavior),
    reduced ? 120 : 900,
  );
}
