import { clsx } from 'clsx';

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={clsx(
        'inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-slate-300 bg-white px-1 font-mono text-[10px] font-semibold leading-none text-slate-500 shadow-[0_1px_0_rgba(15,23,42,0.08)]',
        className
      )}
    >
      {children}
    </kbd>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</span>;
}
