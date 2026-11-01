import { clsx } from 'clsx';

/** Kicker + heading + intro used by the home page sections. */
export function LandingSectionHead({
  kicker,
  heading,
  intro,
  light = false,
  center = false,
  className,
}: {
  kicker?: string;
  heading: string;
  intro?: string;
  light?: boolean;
  center?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('max-w-3xl', center && 'mx-auto text-center', className)}>
      {kicker && <p className={clsx('landing-kicker', light && 'landing-kicker-light')}>{kicker}</p>}
      <h2
        className={clsx(
          'mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl 2xl:text-5xl',
          light ? 'text-white' : 'text-slate-900',
        )}
      >
        {heading}
      </h2>
      {intro && (
        <p className={clsx('mt-4 text-lg leading-relaxed 2xl:text-xl', light ? 'text-primary-100' : 'text-slate-600')}>
          {intro}
        </p>
      )}
    </div>
  );
}
