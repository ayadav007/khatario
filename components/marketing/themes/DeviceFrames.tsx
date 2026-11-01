import type { ReactNode } from 'react';

/** A laptop around a computer-width preview: dark bezel, then a thin base. */
export function LaptopFrame({ children }: { children: ReactNode }) {
  return (
    <div className="w-full">
      <div className="rounded-t-xl border-[10px] border-b-[14px] border-slate-900 bg-slate-900 shadow-xl">
        <div className="overflow-hidden rounded-sm bg-white">{children}</div>
      </div>
      <div className="mx-auto h-3 w-[112%] -translate-x-[5.4%] rounded-b-xl bg-gradient-to-b from-slate-300 to-slate-400" />
    </div>
  );
}

/** A phone around a phone-width preview. */
export function PhoneFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[1.6rem] border-[7px] border-slate-900 bg-slate-900 shadow-2xl ${className}`}>
      <div className="mx-auto mb-1 h-1.5 w-12 rounded-full bg-slate-700" aria-hidden />
      <div className="overflow-hidden rounded-[1.1rem] bg-white">{children}</div>
    </div>
  );
}
