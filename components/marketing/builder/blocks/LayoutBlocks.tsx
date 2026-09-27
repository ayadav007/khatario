'use client';

import { clsx } from 'clsx';
import type { CSSProperties, ReactNode } from 'react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { cleanAnchor, ToneProvider, useTone, type Tone } from '@/components/marketing/builder/blocks/tone';

export type SectionBackground = 'white' | 'muted' | 'tint' | 'gradient' | 'dark' | 'brand' | 'image';
export type SectionProps = {
  background: SectionBackground;
  backgroundImage?: string;
  overlay: 'none' | 'light' | 'medium' | 'strong';
  width: 'full' | 'wide' | 'narrow';
  paddingY: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  border: 'none' | 'top' | 'bottom' | 'both';
  anchor?: string;
};

const SECTION_BG: Record<SectionBackground, string> = {
  white: 'bg-white',
  muted: 'bg-slate-50/90',
  tint: 'bg-primary-50',
  gradient: 'bg-gradient-to-b from-slate-50 via-white to-slate-50/80',
  dark: 'bg-slate-900',
  brand: 'bg-primary-700',
  image: 'bg-slate-900 bg-cover bg-center',
};

const SECTION_PY: Record<SectionProps['paddingY'], string> = {
  none: 'py-0',
  sm: 'py-8 md:py-10',
  md: 'py-12 md:py-16',
  lg: 'py-16 md:py-20 2xl:py-24',
  xl: 'py-20 md:py-28 2xl:py-32',
};

const SECTION_WIDTH: Record<SectionProps['width'], string> = {
  full: '',
  wide: 'max-w-7xl',
  narrow: 'max-w-3xl',
};

const SECTION_BORDER: Record<SectionProps['border'], string> = {
  none: '',
  top: 'border-t border-slate-200/80',
  bottom: 'border-b border-slate-200/80',
  both: 'border-y border-slate-200/80',
};

const OVERLAY: Record<SectionProps['overlay'], string> = {
  none: '',
  light: 'bg-slate-900/30',
  medium: 'bg-slate-900/55',
  strong: 'bg-slate-900/75',
};

export function sectionTone(background: SectionBackground): Tone {
  return background === 'dark' || background === 'brand' || background === 'image' ? 'dark' : 'light';
}

export function SectionBlock({ children, ...p }: SectionProps & { children: ReactNode }) {
  const tone = sectionTone(p.background);
  const style: CSSProperties | undefined =
    p.background === 'image' && p.backgroundImage
      ? { backgroundImage: `url("${p.backgroundImage.replace(/["\\\n]/g, '')}")` }
      : undefined;

  return (
    <section
      id={cleanAnchor(p.anchor)}
      className={clsx(
        'relative scroll-mt-24 overflow-hidden',
        SECTION_BG[p.background] ?? SECTION_BG.white,
        SECTION_PY[p.paddingY] ?? SECTION_PY.lg,
        SECTION_BORDER[p.border] ?? '',
      )}
      style={style}
    >
      {p.background === 'image' && p.overlay !== 'none' && (
        <div className={clsx('pointer-events-none absolute inset-0', OVERLAY[p.overlay])} aria-hidden />
      )}
      {p.background === 'dark' && (
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(45,212,191,0.12),_transparent_55%)]"
          aria-hidden
        />
      )}
      <div className={clsx(LANDING_PAGE_GUTTER, 'relative', SECTION_WIDTH[p.width])}>
        <ToneProvider tone={tone}>{children}</ToneProvider>
      </div>
    </section>
  );
}

export type ColumnsLayout = '1-1' | '1-2' | '2-1' | '1-3' | '3-1' | '5-7' | '7-5' | '1-1-1' | '1-1-1-1';
export type Gap = 'sm' | 'md' | 'lg' | 'xl';

export const COLUMN_COUNT: Record<ColumnsLayout, number> = {
  '1-1': 2,
  '1-2': 2,
  '2-1': 2,
  '1-3': 2,
  '3-1': 2,
  '5-7': 2,
  '7-5': 2,
  '1-1-1': 3,
  '1-1-1-1': 4,
};

/** Columns stack on phones; the template applies from the chosen breakpoint up. */
export const COLUMN_TEMPLATE: Record<'md' | 'lg', Record<ColumnsLayout, string>> = {
  md: {
    '1-1': 'md:grid-cols-2',
    '1-2': 'md:grid-cols-[1fr_2fr]',
    '2-1': 'md:grid-cols-[2fr_1fr]',
    '1-3': 'md:grid-cols-[1fr_3fr]',
    '3-1': 'md:grid-cols-[3fr_1fr]',
    '5-7': 'md:grid-cols-[5fr_7fr]',
    '7-5': 'md:grid-cols-[7fr_5fr]',
    '1-1-1': 'md:grid-cols-3',
    '1-1-1-1': 'sm:grid-cols-2 md:grid-cols-4',
  },
  lg: {
    '1-1': 'lg:grid-cols-2',
    '1-2': 'lg:grid-cols-[1fr_2fr]',
    '2-1': 'lg:grid-cols-[2fr_1fr]',
    '1-3': 'lg:grid-cols-[1fr_3fr]',
    '3-1': 'lg:grid-cols-[3fr_1fr]',
    '5-7': 'lg:grid-cols-[5fr_7fr]',
    '7-5': 'lg:grid-cols-[7fr_5fr]',
    '1-1-1': 'sm:grid-cols-2 lg:grid-cols-3',
    '1-1-1-1': 'sm:grid-cols-2 lg:grid-cols-4',
  },
};

export const GAP: Record<Gap, string> = {
  sm: 'gap-4',
  md: 'gap-6 lg:gap-8',
  lg: 'gap-8 lg:gap-12',
  xl: 'gap-10 lg:gap-16 2xl:gap-20',
};

export const VERTICAL_ALIGN: Record<'start' | 'center' | 'end' | 'stretch', string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

export const STACK_GAP = 'flex flex-col gap-5';

export type CardStyle = 'plain' | 'outlined' | 'shadow' | 'tinted' | 'dark' | 'glass';
export type CardProps = { style: CardStyle; padding: 'sm' | 'md' | 'lg'; fullHeight: boolean };

const CARD_STYLE: Record<CardStyle, string> = {
  plain: 'bg-white',
  outlined: 'border border-slate-200 bg-white',
  shadow: 'border border-slate-200 bg-white shadow-md transition hover:shadow-lg',
  tinted: 'border border-slate-200 bg-slate-50/80',
  dark: 'bg-slate-900',
  glass: 'border border-white/10 bg-white/[0.05]',
};

const CARD_PAD: Record<CardProps['padding'], string> = {
  sm: 'p-4',
  md: 'p-6 2xl:p-8',
  lg: 'p-8 md:p-10',
};

export function CardBlock({ children, style, padding, fullHeight }: CardProps & { children: ReactNode }) {
  const parentTone = useTone();
  const tone: Tone = style === 'dark' || (style === 'glass' && parentTone === 'dark') ? 'dark' : 'light';
  return (
    <div
      className={clsx(
        'rounded-2xl',
        CARD_STYLE[style] ?? CARD_STYLE.outlined,
        CARD_PAD[padding] ?? CARD_PAD.md,
        fullHeight && 'h-full',
      )}
    >
      <ToneProvider tone={tone}>{children}</ToneProvider>
    </div>
  );
}

const SPACER: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string> = {
  xs: 'h-2',
  sm: 'h-4',
  md: 'h-8',
  lg: 'h-12 md:h-16',
  xl: 'h-16 md:h-24',
};

export function SpacerBlock({ size, desktopOnly }: { size: keyof typeof SPACER; desktopOnly: boolean }) {
  return <div className={clsx(SPACER[size] ?? SPACER.md, desktopOnly && 'hidden md:block')} aria-hidden />;
}

export function DividerBlock({ style }: { style: 'solid' | 'dashed' }) {
  const tone = useTone();
  return (
    <hr
      className={clsx(
        'my-2 w-full border-t',
        style === 'dashed' && 'border-dashed',
        tone === 'dark' ? 'border-white/15' : 'border-slate-200',
      )}
    />
  );
}
