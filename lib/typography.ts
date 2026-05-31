/**
 * Semantic typography variants — map to CSS component classes in app/globals.css
 * and Tailwind token utilities (text-sm, text-caption, text-2xs, etc.).
 *
 * Prefer these over arbitrary text-[Npx] or one-off md:text-* pairs.
 */
export const typographyVariants = {
  /** 10px — nav labels, badge counts, micro metadata */
  micro: 'type-micro',
  /** 11px — chart ticks, compact secondary labels */
  caption: 'type-caption',
  /** Form field labels, standard secondary text */
  label: 'type-label',
  /** Uppercase field labels in dense forms (invoice composer) */
  labelCompact: 'type-label-compact',
  /** Uppercase section headers in forms */
  labelSection: 'type-label-section',
  /** Default body copy */
  body: 'type-body',
  /** Secondary / helper body */
  bodySm: 'type-body-sm',
  bodySecondary: 'type-body-secondary',
  /** Page H1 (settings, detail screens) */
  pageTitle: 'type-page-title',
  /** Card / block section heading */
  sectionTitle: 'type-section-title',
  /** Modal / slide-over title */
  panelTitle: 'type-panel-title',
  /** Dashboard KPI numbers */
  kpiValue: 'type-kpi-value',
  /** Bottom nav item labels */
  navLabel: 'type-nav-label',
  /** SVG chart axis labels — pair with text-chart Tailwind utility in JSX */
  chartLabel: 'type-chart-label',
  /** Underline-style numeric inputs (matches --text-input) */
  inputInline: 'type-input-inline',
  /** Debug / mono snippets */
  monoCaption: 'type-mono-caption',
} as const;

export type TypographyVariant = keyof typeof typographyVariants;

/** Tailwind-only shortcuts for programmatic className assembly */
export const textSizeTokens = {
  micro: 'text-2xs',
  caption: 'text-caption',
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
  displaySm: 'text-display-sm',
  display: 'text-display',
  chart: 'text-chart',
  input: 'text-input',
} as const;

/** Drop-in replacements for legacy arbitrary px utilities (codemod target map) */
export const legacyPxToToken: Record<string, string> = {
  'text-[9px]': 'text-2xs',
  'text-[10px]': 'text-2xs',
  'text-[11px]': 'text-caption',
  'text-[12px]': 'text-xs',
  'text-[12.8px]': 'text-xs',
  'text-[13px]': 'text-sm',
  'text-[14px]': 'text-sm',
  'text-[14.2px]': 'text-sm',
  'text-[15px]': 'text-base',
  'text-[16px]': 'text-base',
  'text-[18px]': 'text-lg',
  'text-[20px]': 'text-xl',
  'text-[21px]': 'text-xl',
  'text-[24px]': 'text-2xl',
  'text-[25.6px]': 'text-2xl',
  'text-[30px]': 'text-3xl',
  'text-[17px]': 'text-lg',
  'text-[28px]': 'text-display',
  'text-[36px]': 'text-display-lg',
  'text-[32px]': 'text-display',
};
