import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingPageShell } from '@/components/marketing/MarketingPageShell';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { getPublicSupportConfig } from '@/lib/marketing-public-config';
import { SECURITY_CLAIMS } from '@/lib/marketing/security-claims';

const TITLE = 'How Khatario Keeps Your Data Safe';
const DESCRIPTION =
  "How Khatario protects your shop's bills, customers and accounts: separate data for every business and data export.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/security' },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'Khatario', images: ['/opengraph-image'] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const CARD = 'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm';

export default function SecurityPage() {
  const { email } = getPublicSupportConfig();

  return (
    <MarketingPageShell
      title="How Khatario keeps your data safe"
      intro="Your bills, customers and accounts are the heart of your shop. This is how Khatario looks after them."
    >
      <section className="bg-slate-50 py-14 md:py-16">
        <div className={`${LANDING_PAGE_GUTTER} w-full`}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SECURITY_CLAIMS.map((claim) => (
              <li key={claim.id} className={CARD}>
                <h2 className="text-lg font-semibold text-slate-900">{claim.title}</h2>
                <p className="mt-2 text-base leading-relaxed text-slate-600">{claim.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-white py-14 md:py-16">
        <div className={`${LANDING_PAGE_GUTTER} w-full`}>
          <div className="max-w-3xl">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Report a security problem</h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              If you think you have found a security problem in Khatario, please tell us so we can fix it.
              {email && (
                <>
                  {' '}Write to{' '}
                  <a href={`mailto:${email}`} className="font-semibold text-primary-700 hover:text-primary-800">
                    {email}
                  </a>
                  .
                </>
              )}
            </p>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              To learn what data we collect and how we use it, read our{' '}
              <Link href="/privacy" className="font-semibold text-primary-700 hover:text-primary-800">
                privacy policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </MarketingPageShell>
  );
}
