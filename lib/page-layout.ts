/**
 * Wide content column — uses full main area up to very large viewports.
 * Settings screens, FormPageContainer, and similar dense UIs.
 */
export const WIDE_PAGE_CONTENT_CLASS = 'w-full min-w-0 max-w-[1920px]';

/** Standard main column padding (responsive spacing tokens in globals.css). */
export const APP_MAIN_PADDING_CLASS = 'px-page-x pt-page-y pb-20 md:pb-page-y';

/** Invoice composer / tighter top padding on mobile. */
export const APP_MAIN_PADDING_COMPACT_CLASS =
  'px-page-x pt-page-y-compact pb-20 md:pb-page-y';

/** Vertical rhythm between major page blocks. */
export const STACK_PAGE_CLASS = 'space-y-stack-page';

/** Vertical rhythm between sections / cards on a page. */
export const STACK_SECTION_CLASS = 'space-y-stack-section';

/** Tight stacks (form fields, KPI rows). */
export const STACK_TIGHT_CLASS = 'space-y-stack-tight';
