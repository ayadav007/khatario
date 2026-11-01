'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { withDefaults } from '@/lib/marketing-builder/merge';
import { LandingSectionHead } from '@/components/marketing/landing/LandingSectionHead';

export type LandingStaffManagementContent = {
  kicker: string;
  heading: string;
  intro: string;
  freeLine: string;
  points: { title: string; text: string }[];
  ctaLabel: string;
  ctaHref: string;
};

export const LANDING_STAFF_MANAGEMENT_DEFAULTS: LandingStaffManagementContent = {
  kicker: 'Staff management',
  heading: 'Attendance, payroll and leave, without the register',
  intro: 'Staff check in from their own phone at the shop. Khatario checks they are really there, then works out salary from attendance.',
  freeLine: 'HR Lite for up to 30 staff, included with every Billing plan',
  points: [
    { title: 'Location and shop Wi-Fi', text: 'Several GPS readings and nearby Wi-Fi are checked against your shops.' },
    { title: 'Fake GPS blocked', text: 'Rooted phones, emulators and developer mode are caught.' },
    { title: 'You decide the doubtful ones', text: 'Odd check-ins wait for your OK on the Attendance page.' },
    { title: 'Payroll from attendance', text: 'Attendance and leave flow into the month’s salary.' },
  ],
  ctaLabel: 'Just need HR? Start the HR trial',
  ctaHref: '/?product=hr',
};

const ROWS = [
  { ini: 'RP', name: 'Ravi Patil', note: 'In 9:02 AM', tag: 'Present', tagCls: 'bg-emerald-50 text-emerald-800' },
  { ini: 'SK', name: 'Sunita Kale', note: 'In 9:10 AM', tag: 'Present', tagCls: 'bg-emerald-50 text-emerald-800' },
  { ini: 'AS', name: 'Amit Shinde', note: 'In 10:24 AM · location unclear', tag: 'Needs your OK', tagCls: 'bg-accent-50 text-accent-800' },
  { ini: 'MD', name: 'Meena Desai', note: 'Leave approved', tag: 'On leave', tagCls: 'bg-slate-100 text-slate-800' },
];

/** Check-in phone + today's attendance list. Illustration with sample names. */
function AttendanceMock() {
  return (
    <div className="relative min-h-[30rem]">
      <div className="ml-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-900/15 sm:ml-52 sm:mt-10">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-bold text-slate-900">Today · FC Road shop</p>
          <span className="text-xs text-slate-600">Wed, 15 Oct</span>
        </div>
        {ROWS.map((r) => (
          <div key={r.name} className="flex items-center gap-3 border-t border-slate-100 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-50 text-xs font-bold text-primary-600">
              {r.ini}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">{r.name}</span>
              <span className="block text-xs text-slate-600">{r.note}</span>
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${r.tagCls}`}>{r.tag}</span>
          </div>
        ))}
      </div>
      <div className="absolute left-0 top-0 hidden w-48 rounded-[2rem] bg-slate-900 p-2 shadow-2xl sm:block">
        <div className="flex flex-col items-center gap-2 rounded-[1.6rem] bg-white px-4 py-6 text-center">
          <p className="text-[11px] text-slate-600">Wed, 15 Oct · FC Road shop</p>
          <p className="text-3xl font-extrabold tracking-tight text-primary-600">9:02 AM</p>
          <span className="my-1 grid h-20 w-20 place-items-center rounded-full bg-emerald-600">
            <Check className="h-10 w-10 text-white" strokeWidth={3} aria-hidden />
          </span>
          <p className="font-bold text-slate-900">Checked in</p>
          <p className="text-xs leading-relaxed text-emerald-800">
            At the shop
            <br />
            Shop Wi-Fi seen
            <br />
            Real device
          </p>
        </div>
      </div>
    </div>
  );
}

export function LandingStaffManagement(props: Partial<LandingStaffManagementContent> = {}) {
  const c = withDefaults(LANDING_STAFF_MANAGEMENT_DEFAULTS, props);
  return (
    <section id="staff" className="scroll-mt-24 bg-primary-50 py-20 2xl:py-28">
      <div className={`${LANDING_PAGE_GUTTER} grid items-center gap-14 lg:grid-cols-[1fr_0.95fr]`}>
        <div>
          <LandingSectionHead kicker={c.kicker} heading={c.heading} intro={c.intro} />
          {c.freeLine && (
            <p className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white">
              <span className="rounded-md bg-accent-500 px-2 py-0.5 text-xs font-extrabold text-slate-950">FREE</span>
              {c.freeLine}
            </p>
          )}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {c.points.map((p) => (
              <div key={p.title} className="rounded-2xl bg-white p-4">
                <p className="font-bold text-slate-900">{p.title}</p>
                <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{p.text}</p>
              </div>
            ))}
          </div>
          {c.ctaLabel && (
            <Link
              href={c.ctaHref || '/?product=hr'}
              className="mt-7 inline-flex min-h-[48px] items-center rounded-xl border-2 border-primary-600 bg-white px-6 text-base font-semibold text-primary-600 transition hover:bg-primary-50"
            >
              {c.ctaLabel}
            </Link>
          )}
        </div>
        <AttendanceMock />
      </div>
    </section>
  );
}
