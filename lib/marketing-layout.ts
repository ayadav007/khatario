/** Horizontal padding for landing / marketing pages — full width with comfortable edges on ultra-wide screens. */
export const LANDING_PAGE_GUTTER =
  'mx-auto w-full px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 2xl:px-14 min-[1920px]:px-16';

/**
 * Use the full width inside `LANDING_PAGE_GUTTER` (no `max-w-*` column — avoids empty side space).
 */
export const LANDING_MAX_WIDE = 'w-full';

/**
 * Section heading block: full width, centered on very small viewports, left-aligned from `md` up
 * so long pages do not look like a narrow strip in the middle of the screen.
 */
export const LANDING_SECTION_INTRO = 'w-full text-center md:text-left';

/**
 * Subcopy under a section H2: comfortable reading measure without shrinking the page width.
 * Use with `mx-auto` only on `max-md` if needed, and `md:mx-0`.
 */
export const LANDING_INTRO_SUBTEXT =
  'mt-3 mx-auto max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-lg md:mx-0 2xl:mt-4 2xl:max-w-3xl 2xl:text-xl 2xl:leading-relaxed';

/** Medium blocks: problem/solution, walkthrough, comparison — also full-bleed within gutter. */
export const LANDING_MAX_MEDIUM = 'w-full';
