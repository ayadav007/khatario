import Image from 'next/image';
import { clsx } from 'clsx';

type Props = {
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  /** Fill the nearest positioned parent (parent needs `relative` and a size). */
  fill?: boolean;
  width?: number;
  height?: number;
};

/** next/image for site-local files; a plain lazy <img> for external https images (not in next.config remotePatterns). */
export function MarketingImg({ src, alt, className, sizes, priority, fill, width = 1600, height = 1000 }: Props) {
  if (!src) return null;
  if (src.startsWith('/')) {
    return fill ? (
      <Image src={src} alt={alt} fill sizes={sizes ?? '100vw'} priority={priority} className={className} />
    ) : (
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes ?? '100vw'}
        priority={priority}
        className={clsx('h-auto w-full', className)}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      className={clsx(fill ? 'absolute inset-0 h-full w-full' : 'h-auto w-full', className)}
    />
  );
}
