'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { ArrowRight, Quote, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { SafeMarkdown } from '@/components/marketing/builder/SafeMarkdown';
import { MarketingImg } from '@/components/marketing/builder/MarketingImg';
import { MarketingIcon } from '@/components/marketing/builder/icons';
import {
  ITEMS_ALIGN,
  JUSTIFY,
  TEXT_ALIGN,
  useTone,
  type Align,
} from '@/components/marketing/builder/blocks/tone';
import { youtubeId } from '@/lib/marketing-builder/safe-url';

function SmartLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  const external = /^https?:\/\//i.test(href);
  return (
    <a href={href} className={className} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
    </a>
  );
}

/* Heading ------------------------------------------------------------------ */

export type HeadingProps = {
  eyebrow?: string;
  text: string;
  level: 'h1' | 'h2' | 'h3' | 'h4';
  size: 'sm' | 'md' | 'lg' | 'xl' | 'display';
  align: Align;
};

const HEADING_SIZE: Record<HeadingProps['size'], string> = {
  sm: 'text-lg font-semibold 2xl:text-xl',
  md: 'text-2xl font-bold sm:text-3xl 2xl:text-4xl',
  lg: 'text-3xl font-bold sm:text-4xl 2xl:text-5xl',
  xl: 'text-4xl font-extrabold sm:text-5xl 2xl:text-6xl',
  display: 'text-4xl font-extrabold leading-[1.08] sm:text-5xl lg:text-6xl 2xl:text-7xl',
};

/** `**words**` in a heading are shown in the brand colour. */
function renderAccent(text: string, accentClass: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <span key={i} className={accentClass}>
        {part.slice(2, -2)}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function HeadingBlock({ eyebrow, text, level, size, align }: HeadingProps) {
  const tone = useTone();
  const Tag = level;
  return (
    <div className={clsx('mb-heading w-full', TEXT_ALIGN[align])}>
      {eyebrow && (
        <p
          className={clsx(
            'mb-3 text-sm font-semibold uppercase tracking-wider',
            tone === 'dark' ? 'text-primary-300' : 'text-primary-700',
          )}
        >
          {eyebrow}
        </p>
      )}
      <Tag
        className={clsx(
          'tracking-tight',
          HEADING_SIZE[size] ?? HEADING_SIZE.lg,
          tone === 'dark' ? 'text-white' : 'text-slate-900',
        )}
      >
        {renderAccent(text, tone === 'dark' ? 'text-primary-300' : 'text-primary-600')}
      </Tag>
    </div>
  );
}

/* Text --------------------------------------------------------------------- */

export type TextProps = { text: string; size: 'sm' | 'md' | 'lg'; align: Align; width: 'full' | 'prose' };

const TEXT_SIZE: Record<TextProps['size'], string> = {
  sm: 'text-sm leading-relaxed',
  md: 'text-base leading-relaxed 2xl:text-lg',
  lg: 'text-lg leading-relaxed sm:text-xl 2xl:text-[1.35rem]',
};

export function TextBlock({ text, size, align, width }: TextProps) {
  const tone = useTone();
  return (
    <SafeMarkdown
      text={text}
      className={clsx(
        TEXT_SIZE[size] ?? TEXT_SIZE.md,
        TEXT_ALIGN[align],
        tone === 'dark' ? 'text-slate-300' : 'text-slate-600',
        width === 'prose' && 'max-w-2xl',
        width === 'prose' && align === 'center' && 'mx-auto',
        width === 'prose' && align === 'right' && 'ml-auto',
      )}
      linkClassName={tone === 'dark' ? 'text-primary-300' : 'text-primary-700'}
    />
  );
}

/* Image -------------------------------------------------------------------- */

export type ImageProps = {
  image: string;
  alt: string;
  aspect: 'auto' | '16/9' | '16/10' | '4/3' | '1/1' | '3/4';
  fit: 'cover' | 'contain';
  rounded: 'none' | 'md' | 'xl';
  shadow: boolean;
  caption?: string;
  href?: string;
};

const ASPECT: Record<Exclude<ImageProps['aspect'], 'auto'>, string> = {
  '16/9': 'aspect-video',
  '16/10': 'aspect-[16/10]',
  '4/3': 'aspect-[4/3]',
  '1/1': 'aspect-square',
  '3/4': 'aspect-[3/4]',
};

const ROUNDED: Record<ImageProps['rounded'], string> = { none: '', md: 'rounded-lg', xl: 'rounded-2xl' };

function ImagePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-sm font-medium text-slate-500">
      {label}
    </div>
  );
}

export function ImageBlock(p: ImageProps) {
  const tone = useTone();
  if (!p.image) return <ImagePlaceholder label="Choose an image" />;
  const frame = clsx(
    'relative w-full overflow-hidden',
    ROUNDED[p.rounded],
    p.shadow && 'shadow-xl shadow-slate-900/10',
    p.aspect !== 'auto' && ASPECT[p.aspect],
  );
  const img =
    p.aspect === 'auto' ? (
      <div className={frame}>
        <MarketingImg src={p.image} alt={p.alt} sizes="(min-width: 1024px) 60vw, 100vw" />
      </div>
    ) : (
      <div className={frame}>
        <MarketingImg
          src={p.image}
          alt={p.alt}
          fill
          sizes="(min-width: 1024px) 60vw, 100vw"
          className={p.fit === 'contain' ? 'object-contain' : 'object-cover object-top'}
        />
      </div>
    );
  return (
    <figure className="w-full">
      {p.href ? (
        <SmartLink href={p.href} className="block">
          {img}
        </SmartLink>
      ) : (
        img
      )}
      {p.caption && (
        <figcaption className={clsx('mt-3 text-sm', tone === 'dark' ? 'text-slate-400' : 'text-slate-600')}>
          {p.caption}
        </figcaption>
      )}
    </figure>
  );
}

/* Buttons ------------------------------------------------------------------ */

export type ButtonItem = {
  label: string;
  href: string;
  style: 'primary' | 'secondary' | 'outline' | 'link';
  arrow: boolean;
};
export type ButtonsProps = { buttons: ButtonItem[]; align: Align; size: 'md' | 'lg'; stackOnMobile: boolean };

const BTN_SIZE = { md: 'px-5 py-3 text-base', lg: 'px-7 py-3.5 text-lg' } as const;

function buttonClass(style: ButtonItem['style'], tone: 'light' | 'dark'): string {
  switch (style) {
    case 'secondary':
      return tone === 'dark'
        ? 'bg-white text-slate-900 hover:bg-slate-100'
        : 'bg-slate-900 text-white hover:bg-slate-800';
    case 'outline':
      return tone === 'dark'
        ? 'border-2 border-white/70 text-white hover:bg-white/10'
        : 'border-2 border-primary-600 bg-white text-primary-600 hover:bg-slate-50';
    case 'link':
      return tone === 'dark'
        ? '!px-2 text-slate-200 underline-offset-4 hover:underline'
        : '!px-2 text-slate-600 underline-offset-4 hover:text-primary-600 hover:underline';
    default:
      return 'bg-primary-600 text-white shadow-md hover:bg-primary-700 hover:shadow-lg';
  }
}

export function ButtonsBlock({ buttons, align, size, stackOnMobile }: ButtonsProps) {
  const tone = useTone();
  const items = (buttons ?? []).filter((b) => b.label);
  if (items.length === 0) return null;
  return (
    <div
      className={clsx(
        'flex flex-wrap gap-3',
        stackOnMobile && 'max-sm:flex-col max-sm:items-stretch',
        JUSTIFY[align],
      )}
    >
      {items.map((b, i) => (
        <SmartLink
          key={`${b.label}-${i}`}
          href={b.href || '#'}
          className={clsx(
            'group inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition',
            BTN_SIZE[size] ?? BTN_SIZE.lg,
            buttonClass(b.style, tone),
          )}
        >
          {b.label}
          {b.arrow && <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden />}
        </SmartLink>
      ))}
    </div>
  );
}

/* Badge -------------------------------------------------------------------- */

export type BadgeProps = { text: string; icon: string; tone: 'neutral' | 'brand' | 'amber'; align: Align };

export function BadgeBlock({ text, icon, tone: badgeTone, align }: BadgeProps) {
  const tone = useTone();
  const palette =
    badgeTone === 'brand'
      ? 'border-primary-200 bg-primary-50 text-primary-800'
      : badgeTone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : tone === 'dark'
          ? 'border-white/15 bg-white/5 text-slate-200'
          : 'border-slate-200 bg-white text-slate-600';
  return (
    <div className={clsx('flex w-full', JUSTIFY[align])}>
      <span
        className={clsx(
          'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider shadow-sm sm:text-sm',
          palette,
        )}
      >
        {icon && icon !== 'none' && <MarketingIcon name={icon} className="h-3.5 w-3.5" />}
        {text}
      </span>
    </div>
  );
}

/* Icon list ---------------------------------------------------------------- */

export type IconListItem = { icon: string; title: string; text: string; tag?: string };
export type IconListProps = {
  items: IconListItem[];
  layout: 'list' | 'grid-2' | 'grid-3' | 'grid-4';
  iconStyle: 'plain' | 'boxed' | 'check';
};

const ICON_LIST_LAYOUT: Record<IconListProps['layout'], string> = {
  list: 'grid gap-5',
  'grid-2': 'grid gap-x-8 gap-y-7 sm:grid-cols-2',
  'grid-3': 'grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3',
  'grid-4': 'grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4',
};

export function IconListBlock({ items, layout, iconStyle }: IconListProps) {
  const tone = useTone();
  return (
    <ul className={ICON_LIST_LAYOUT[layout] ?? ICON_LIST_LAYOUT['grid-2']}>
      {(items ?? []).map((item, i) => (
        <li key={i} className="flex gap-4">
          {iconStyle === 'boxed' ? (
            <span
              className={clsx(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1',
                tone === 'dark'
                  ? 'bg-[rgba(45,212,191,0.12)] text-primary-300 ring-[rgba(45,212,191,0.3)]'
                  : 'bg-white text-primary-700 ring-slate-200',
              )}
            >
              <MarketingIcon name={item.icon} className="h-5 w-5" />
            </span>
          ) : (
            <MarketingIcon
              name={iconStyle === 'check' ? 'checkCircle' : item.icon}
              className={clsx(
                'mt-0.5 h-5 w-5 shrink-0',
                iconStyle === 'check' ? 'text-emerald-600' : tone === 'dark' ? 'text-primary-300' : 'text-primary-600',
              )}
            />
          )}
          <div className="min-w-0">
            {item.title && (
              <h3 className={clsx('font-bold leading-snug 2xl:text-lg', tone === 'dark' ? 'text-white' : 'text-slate-900')}>
                {item.title}
              </h3>
            )}
            {item.tag && (
              <span className="mt-1 inline-block rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                {item.tag}
              </span>
            )}
            {item.text && (
              <SafeMarkdown
                inline
                text={item.text}
                className={clsx(
                  'mt-1.5 block leading-relaxed 2xl:text-lg',
                  tone === 'dark' ? 'text-slate-300' : 'text-slate-600',
                )}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* Stats -------------------------------------------------------------------- */

export type StatsProps = { items: { value: string; label: string }[]; columns: '2' | '3' | '4'; style: 'plain' | 'cards' };

const STATS_COLS: Record<StatsProps['columns'], string> = {
  '2': 'sm:grid-cols-2',
  '3': 'sm:grid-cols-3',
  '4': 'sm:grid-cols-2 lg:grid-cols-4',
};

export function StatsBlock({ items, columns, style }: StatsProps) {
  const tone = useTone();
  return (
    <div className={clsx('grid w-full grid-cols-1 gap-6 sm:gap-8', STATS_COLS[columns] ?? STATS_COLS['3'])}>
      {(items ?? []).map((s, i) => (
        <div
          key={i}
          className={clsx(
            style === 'cards' &&
              (tone === 'dark'
                ? 'rounded-2xl border border-white/10 bg-white/[0.04] p-6'
                : 'rounded-2xl border border-slate-200 bg-slate-50/80 p-6 2xl:p-8'),
          )}
        >
          <p className={clsx('text-3xl font-bold sm:text-4xl 2xl:text-5xl', tone === 'dark' ? 'text-white' : 'text-slate-900')}>
            {s.value}
          </p>
          <p className={clsx('mt-1 text-sm font-medium', tone === 'dark' ? 'text-slate-300' : 'text-slate-600')}>
            {s.label}
          </p>
        </div>
      ))}
    </div>
  );
}

/* Screenshot --------------------------------------------------------------- */

export type ScreenshotProps = { image: string; alt: string; frame: 'browser' | 'phone' | 'none'; caption?: string };

export function ScreenshotBlock({ image, alt, frame, caption }: ScreenshotProps) {
  const tone = useTone();
  if (!image) return <ImagePlaceholder label="Choose a screenshot" />;
  const body =
    frame === 'phone' ? (
      <div className="mx-auto w-full max-w-[18rem] rounded-[2.2rem] border-[10px] border-slate-900 bg-slate-900 shadow-2xl">
        <div className="relative aspect-[9/19] overflow-hidden rounded-[1.6rem] bg-white">
          <MarketingImg src={image} alt={alt} fill sizes="288px" className="object-cover object-top" />
        </div>
      </div>
    ) : frame === 'browser' ? (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
        <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-2.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        </div>
        <div className="relative aspect-[16/10]">
          <MarketingImg src={image} alt={alt} fill sizes="(min-width: 1024px) 60vw, 100vw" className="object-cover object-left-top" />
        </div>
      </div>
    ) : (
      <div className="relative aspect-[16/10] overflow-hidden rounded-2xl">
        <MarketingImg src={image} alt={alt} fill sizes="(min-width: 1024px) 60vw, 100vw" className="object-cover object-left-top" />
      </div>
    );
  return (
    <figure className="w-full">
      {body}
      {caption && (
        <figcaption className={clsx('mt-3 text-sm', tone === 'dark' ? 'text-slate-400' : 'text-slate-600')}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/* Video -------------------------------------------------------------------- */

export type VideoProps = { videoUrl: string; title: string };

export function VideoBlock({ videoUrl, title }: VideoProps) {
  const id = youtubeId(videoUrl ?? '');
  if (!id) return <ImagePlaceholder label="Paste a YouTube link" />;
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-900 shadow-xl">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}?rel=0`}
        title={title || 'Video'}
        loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="absolute inset-0 h-full w-full"
      />
    </div>
  );
}

/* Testimonial -------------------------------------------------------------- */

export type TestimonialProps = { quote: string; name: string; role: string; avatarImage?: string; rating: number };

export function TestimonialBlock({ quote, name, role, avatarImage, rating }: TestimonialProps) {
  const tone = useTone();
  const stars = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return (
    <figure className={clsx('flex h-full flex-col', ITEMS_ALIGN.left)}>
      <Quote className={clsx('h-6 w-6', tone === 'dark' ? 'text-primary-300' : 'text-primary-600')} aria-hidden />
      {stars > 0 && (
        <div className="mt-3 flex gap-0.5" aria-label={`${stars} out of 5 stars`}>
          {Array.from({ length: stars }).map((_, i) => (
            <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
          ))}
        </div>
      )}
      <blockquote
        className={clsx('mt-3 flex-1 text-lg leading-relaxed', tone === 'dark' ? 'text-slate-100' : 'text-slate-800')}
      >
        {quote}
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        {avatarImage && (
          <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-slate-200">
            <MarketingImg src={avatarImage} alt="" fill sizes="44px" className="object-cover" />
          </span>
        )}
        <span>
          <span className={clsx('block font-semibold', tone === 'dark' ? 'text-white' : 'text-slate-900')}>{name}</span>
          {role && (
            <span className={clsx('block text-sm', tone === 'dark' ? 'text-slate-400' : 'text-slate-600')}>{role}</span>
          )}
        </span>
      </figcaption>
    </figure>
  );
}
