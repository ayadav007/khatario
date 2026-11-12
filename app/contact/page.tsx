import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BookOpen, CalendarCheck, Mail, MessageCircle, Phone } from 'lucide-react';
import { MarketingPageShell } from '@/components/marketing/MarketingPageShell';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { publicSiteUrl } from '@/lib/blog/site';
import { getPublicSupportConfig } from '@/lib/marketing-public-config';
import { khatarioOrganizationJsonLd } from '@/lib/marketing/brand-structured-data';
import { KHATARIO_COMPANY_FACTS } from '@/lib/marketing/company-facts';
import { getContactDetails, type ContactChannel } from '@/lib/marketing/contact-details';

const TITLE = 'Contact Khatario | Support, Sales and Grievance Officer';
const DESCRIPTION = 'Reach Khatario support by email or WhatsApp, book a demo, or write to our grievance officer.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/contact' },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'Khatario', images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const CARD = 'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm';
const ICONS = { email: Mail, whatsapp: MessageCircle, phone: Phone } as const;

function ChannelCard({ channel, hours }: { channel: ContactChannel; hours: string }) {
  const Icon = ICONS[channel.kind];
  return (
    <li className={CARD}>
      <Icon className="h-6 w-6 text-primary-600" aria-hidden />
      <h2 className="mt-3 text-lg font-semibold text-slate-900">{channel.label}</h2>
      <a
        href={channel.href}
        className="mt-2 block break-words text-base font-semibold text-primary-700 hover:text-primary-800"
        {...(channel.kind === 'whatsapp' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {channel.value}
      </a>
      <p className="mt-2 text-sm text-slate-500">{hours}</p>
    </li>
  );
}

export default function ContactPage() {
  const site = publicSiteUrl();
  const details = getContactDetails(KHATARIO_COMPANY_FACTS, getPublicSupportConfig());
  const { channels, hours, office, grievance } = details;

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      khatarioOrganizationJsonLd(site),
      {
        '@type': 'ContactPage',
        '@id': `${site}/contact#webpage`,
        url: `${site}/contact`,
        name: TITLE,
        description: DESCRIPTION,
        inLanguage: 'en-IN',
        about: { '@id': `${site}/#organization` },
        isPartOf: { '@id': `${site}/#website` },
      },
    ],
  };

  return (
    <MarketingPageShell
      title="Contact Khatario"
      intro="Questions about your account, plans or switching from another billing app? Write to us."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />

      <section className="bg-slate-50 py-14 md:py-16">
        <div className={`${LANDING_PAGE_GUTTER} w-full`}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {channels.map((channel) => (
              <ChannelCard key={channel.kind} channel={channel} hours={hours} />
            ))}
            {channels.length === 0 && (
              <li className={CARD}>
                <CalendarCheck className="h-6 w-6 text-primary-600" aria-hidden />
                <h2 className="mt-3 text-lg font-semibold text-slate-900">Book a demo</h2>
                <p className="mt-2 text-base leading-relaxed text-slate-600">Pick a time and we will walk you through Khatario.</p>
                <Link href="/book-demo" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:text-primary-800">
                  Book a demo <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </li>
            )}
          </ul>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Link href="/book-demo" className={`${CARD} block transition hover:border-primary-300`}>
              <CalendarCheck className="h-6 w-6 text-primary-600" aria-hidden />
              <h2 className="mt-3 text-lg font-semibold text-slate-900">Talk to sales</h2>
              <p className="mt-2 text-base leading-relaxed text-slate-600">Book a free demo and ask anything about plans.</p>
            </Link>
            <Link href="/guides" className={`${CARD} block transition hover:border-primary-300`}>
              <BookOpen className="h-6 w-6 text-primary-600" aria-hidden />
              <h2 className="mt-3 text-lg font-semibold text-slate-900">How-to guides</h2>
              <p className="mt-2 text-base leading-relaxed text-slate-600">Step-by-step help for billing, stock and GST.</p>
            </Link>
          </div>
        </div>
      </section>

      {office && (
        <section className="bg-white py-14 md:py-16">
          <div className={`${LANDING_PAGE_GUTTER} w-full`}>
            <div className="max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Registered office</h2>
              <div className="mt-4 space-y-1 text-base leading-relaxed text-slate-600">
                {office.legalName && <p className="font-semibold text-slate-900">{office.legalName}</p>}
                {office.addressLines.map((line, i) => (
                  <p key={`${i}-${line}`}>{line}</p>
                ))}
                {office.gstin && <p>GSTIN: {office.gstin}</p>}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="bg-slate-50 py-14 md:py-16">
        <div className={`${LANDING_PAGE_GUTTER} w-full`}>
          <div className="max-w-3xl">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Grievance officer</h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              If you have a complaint about your data or about content on Khatario, you can send it to our grievance officer.
            </p>
            <div className="mt-4 space-y-1 text-base text-slate-700">
              {grievance.officerName && <p>Name: {grievance.officerName}</p>}
              {grievance.email && (
                <p>
                  Email:{' '}
                  <a href={`mailto:${grievance.email}`} className="font-semibold text-primary-700 hover:text-primary-800">
                    {grievance.email}
                  </a>
                </p>
              )}
            </div>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              We acknowledge complaints within 48 hours and resolve them within 15 days.
            </p>
          </div>
        </div>
      </section>
    </MarketingPageShell>
  );
}
