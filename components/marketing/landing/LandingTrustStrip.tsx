import Link from 'next/link';
import { BookOpen, Clock, Headphones, Mail, MessageCircle, PlayCircle, Shield } from 'lucide-react';
import {
  LANDING_INTRO_SUBTEXT,
  LANDING_MAX_WIDE,
  LANDING_PAGE_GUTTER,
  LANDING_SECTION_INTRO,
} from '@/lib/marketing-layout';
import { getPublicSupportConfig } from '@/lib/marketing-public-config';
import { SafeMarkdown } from '@/components/marketing/builder/SafeMarkdown';
import { MarketingIcon } from '@/components/marketing/builder/icons';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type LandingTrustStripContent = {
  heading: string;
  subtext: string;
  supportTitle: string;
  demoTip: string;
  securityTitle: string;
  securityPoints: { icon: string; text: string }[];
  privacyNote: string;
};

export const LANDING_TRUST_STRIP_DEFAULTS: LandingTrustStripContent = {
  heading: 'Help, security, and clarity — in plain language',
  subtext: 'No jargon wall. We want you to feel safe trying Khatario on your own business data.',
  supportTitle: 'Real humans when you need us',
  demoTip: 'Prefer to see it first? A demo is usually faster than a long email thread.',
  securityTitle: 'Your data, treated seriously',
  securityPoints: [
    {
      icon: 'lock',
      text: 'Encrypted **HTTPS** in the browser, with sign-in and role-based access in the app so staff only see what they should.',
    },
    {
      icon: 'server',
      text: 'Your invoices and business records are for **your** work — we don’t sell your customer list to advertisers.',
    },
  ],
  privacyNote: '[Read our privacy policy](/privacy) and [terms](/terms) — we keep them in plain language as they grow.',
};

export function LandingTrustStrip(props: Partial<LandingTrustStripContent> = {}) {
  const c = withDefaults(LANDING_TRUST_STRIP_DEFAULTS, props);
  const { email, whatsappUrl, hours } = getPublicSupportConfig();
  const hasDirectLine = Boolean(email || whatsappUrl);

  return (
    <section
      className="border-b border-slate-200/80 bg-white py-16 2xl:py-20"
      aria-labelledby="trust-support-heading"
    >
      <div className={LANDING_PAGE_GUTTER}>
        <div className={LANDING_SECTION_INTRO}>
          <h2
            id="trust-support-heading"
            className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl 2xl:text-4xl"
          >
            {c.heading}
          </h2>
          {c.subtext && <p className={LANDING_INTRO_SUBTEXT}>{c.subtext}</p>}
        </div>

        <div className={`mt-10 grid gap-8 md:grid-cols-2 md:gap-10 lg:mt-12 2xl:gap-12 ${LANDING_MAX_WIDE}`}>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6 shadow-sm 2xl:p-8">
            <div className="mb-4 flex items-center gap-2 text-slate-800">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200/80">
                <Headphones className="h-5 w-5 text-slate-600" strokeWidth={1.75} aria-hidden />
              </span>
              <h3 className="text-lg font-bold text-slate-900 2xl:text-xl">{c.supportTitle}</h3>
            </div>
            <ul className="space-y-3 text-slate-600 2xl:text-lg">
              <li className="flex gap-2">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                <span>
                  <strong className="font-medium text-slate-800">Typical hours:</strong> {hours}
                </span>
              </li>
              {email && (
                <li className="flex gap-2">
                  <Mail className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                  <span>
                    <strong className="font-medium text-slate-800">Email: </strong>
                    <a
                      href={`mailto:${email}`}
                      className="font-medium text-primary-600 underline-offset-2 hover:underline"
                    >
                      {email}
                    </a>
                  </span>
                </li>
              )}
              {whatsappUrl && (
                <li className="flex gap-2">
                  <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                  <span>
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary-600 underline-offset-2 hover:underline"
                    >
                      Message us on WhatsApp
                    </a>
                    <span className="text-slate-500"> — same app you already use for customers.</span>
                  </span>
                </li>
              )}
            </ul>
            {!hasDirectLine && (
              <p className="mt-4 text-sm text-slate-500 2xl:text-base">
                For sales and onboarding, book a time that fits your day — we&apos;ll show the product on your kind of
                business.
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/book-demo"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 2xl:px-5 2xl:text-base"
              >
                Book a live call
              </Link>
              <Link
                href="/guides"
                className="inline-flex items-center gap-2 text-sm font-semibold text-primary-600 hover:text-primary-700 2xl:text-base"
              >
                <BookOpen className="h-4 w-4" aria-hidden />
                Guides &amp; how-tos
              </Link>
            </div>
            {c.demoTip && (
              <p className="mt-3 flex items-start gap-2 text-sm text-slate-600">
                <PlayCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {c.demoTip}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6 shadow-sm 2xl:p-8">
            <div className="mb-4 flex items-center gap-2 text-slate-800">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200/80">
                <Shield className="h-5 w-5 text-slate-600" strokeWidth={1.75} aria-hidden />
              </span>
              <h3 className="text-lg font-bold text-slate-900 2xl:text-xl">{c.securityTitle}</h3>
            </div>
            <ul className="space-y-3 text-slate-600 2xl:text-lg">
              {c.securityPoints
                .filter((p) => p.text)
                .map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <MarketingIcon name={p.icon} className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
                    <SafeMarkdown inline text={p.text} className="[&_strong]:font-medium [&_strong]:text-slate-800" />
                  </li>
                ))}
            </ul>
            {c.privacyNote && (
              <p className="mt-4 text-sm text-slate-500 2xl:text-base">
                <SafeMarkdown inline text={c.privacyNote} linkClassName="text-primary-600 hover:text-primary-700" />
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
