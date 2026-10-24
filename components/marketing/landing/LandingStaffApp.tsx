'use client';

import { clsx } from 'clsx';
import { useEffect, useState, type RefObject } from 'react';
import { Check } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { useLandingPlans } from '@/components/marketing/landing/LandingPlansContext';
import { sleep } from '@/components/marketing/landing/LandingMotion';
import { useInViewOnce } from '@/hooks/useInViewOnce';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { HR_STAFF_LITE_PLAN_ID } from '@/lib/product-lines';
import { withDefaults } from '@/lib/marketing-builder/merge';
import type { PricingCatalog } from '@/lib/subscription/pricing-catalog';

const STAFF_APP_FEATURE = 'hr_staff_app';

export type LandingStaffAppContent = {
  kicker: string;
  heading: string;
  subtext: string;
  points: { title: string; text: string }[];
};

export const LANDING_STAFF_APP_DEFAULTS: LandingStaffAppContent = {
  kicker: 'Khatario Staff app',
  heading: "Attendance your staff can't fake.",
  subtext:
    "Staff check in from their own phone, which is bound to them, so a login can't be shared. Salary is worked out from real attendance.",
  points: [
    { title: 'Location and shop Wi-Fi.', text: 'Several GPS readings and nearby Wi-Fi are checked against your sites.' },
    { title: 'Fake GPS and emulators blocked.', text: 'Rooted phones, emulators and developer mode are caught.' },
    { title: 'You decide the doubtful ones.', text: 'Odd check-ins wait for you on the Attendance page.' },
  ],
};

const SIGNALS = [
  ['Location · 18 m', 'At shop'],
  ['Shop Wi-Fi', 'Seen'],
  ['Phone check', 'Passed'],
] as const;

function CheckInPhone() {
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInViewOnce({ threshold: 0.5 });
  const [passed, setPassed] = useState(reduced ? SIGNALS.length : 0);

  useEffect(() => {
    if (reduced) {
      setPassed(SIGNALS.length);
      return;
    }
    if (!inView) return;
    let cancelled = false;
    (async () => {
      await sleep(900);
      for (let i = 1; i <= SIGNALS.length && !cancelled; i += 1) {
        setPassed(i);
        await sleep(650);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inView, reduced]);

  const done = passed >= SIGNALS.length;

  return (
    <div ref={ref as RefObject<HTMLDivElement>} className="mx-auto w-full max-w-[19rem] rounded-[2.4rem] bg-slate-900 p-2.5 shadow-2xl shadow-primary-900/25">
      <div className="rounded-[1.9rem] bg-white px-5 pb-6 pt-7 text-center">
        <p className="text-xs text-slate-500">Wed, 15 Oct · FC Road shop</p>
        <p className="text-4xl font-extrabold tracking-tight text-slate-900">9:02 AM</p>
        <div className="relative mx-auto my-5 h-36 w-36" aria-hidden>
          {!done &&
            [0, 1, 2].map((r) => (
              <span key={r} className="landing-radar-ring absolute inset-0 rounded-full border-2 border-primary-600" style={{ animationDelay: `${r * 0.8}s` }} />
            ))}
          <span
            className={clsx(
              'absolute inset-10 grid place-items-center rounded-full text-xs font-bold text-white transition-colors duration-500',
              done ? 'bg-green-600' : 'bg-primary-600',
            )}
          >
            {done ? 'Checked in' : 'Checking…'}
          </span>
        </div>
        <div className="space-y-2 text-left">
          {SIGNALS.map(([label, value], i) => (
            <div key={label} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-[13px]">
              <span className="text-slate-700">{label}</span>
              <span
                className={clsx(
                  'rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold text-green-700 transition-all duration-300',
                  i < passed ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
                )}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Where the Staff app is sold, from the plan matrix: free with Billing (HR Lite) or from the first HR plan that has it. */
function staffAppAvailability(catalog: PricingCatalog | null): string | null {
  if (!catalog) return null;
  const hrPlans = catalog.plans.filter((p) => p.productLine === 'hr');
  const lite = hrPlans.find((p) => p.id === HR_STAFF_LITE_PLAN_ID);
  if (lite?.features.includes(STAFF_APP_FEATURE) && lite.priceMonthly === 0) {
    return 'Included free with every Billing plan.';
  }
  const first = hrPlans.find((p) => p.features.includes(STAFF_APP_FEATURE));
  return first ? `Included from ${first.name}.` : null;
}

export function LandingStaffApp(props: Partial<LandingStaffAppContent> = {}) {
  const c = withDefaults(LANDING_STAFF_APP_DEFAULTS, props);
  const { catalog } = useLandingPlans();
  const availability = staffAppAvailability(catalog);

  return (
    <section id="staff-app" className="scroll-mt-24 bg-slate-50 py-20 2xl:py-28">
      <div className={`${LANDING_PAGE_GUTTER} grid items-center gap-14 lg:grid-cols-2`}>
        <div>
          <LandingReveal>
            {c.kicker && <p className="landing-kicker">{c.kicker}</p>}
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">{c.heading}</h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600 2xl:text-xl">
              {c.subtext}
              {availability ? ` ${availability}` : ''}
            </p>
          </LandingReveal>
          <ul className="mt-8 space-y-4">
            {c.points.map((p, i) => (
              <LandingReveal as="li" key={`${p.title}-${i}`} delay={i * 80} className="grid grid-cols-[1.75rem_1fr] gap-3 text-slate-600">
                <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-primary-50 text-primary-600">
                  <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
                </span>
                <span>
                  <strong className="font-semibold text-slate-900">{p.title}</strong> {p.text}
                </span>
              </LandingReveal>
            ))}
          </ul>
        </div>
        <LandingReveal delay={120}>
          <CheckInPhone />
        </LandingReveal>
      </div>
    </section>
  );
}
