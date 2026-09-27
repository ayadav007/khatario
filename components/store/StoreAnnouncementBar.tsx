'use client';

import clsx from 'clsx';
import type { StoreTheme } from '@/lib/store/store-theme';

export { resolveAnnouncementText } from '@/lib/store/store-theme';

export function StoreAnnouncementBar({
  theme,
  text,
  defaultBg,
  defaultFg,
}: {
  theme: StoreTheme;
  text: string;
  defaultBg: string;
  defaultFg: string;
}) {
  if (!text) return null;
  const style = {
    backgroundColor: theme.announcement_bg || defaultBg,
    color: theme.announcement_fg || defaultFg,
  };
  const className = clsx(
    'block truncate px-4 py-1.5 text-[11px] tracking-[0.02em]',
    theme.announcement_align === 'left' && 'text-left',
    theme.announcement_align === 'center' && 'text-center',
    theme.announcement_align === 'right' && 'text-right',
  );
  if (theme.announcement_link) {
    const external = /^https?:\/\//i.test(theme.announcement_link);
    return (
      <a
        href={theme.announcement_link}
        className={clsx(className, 'hover:underline')}
        style={style}
        {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      >
        {text}
      </a>
    );
  }
  return (
    <div className={className} style={style}>
      {text}
    </div>
  );
}
