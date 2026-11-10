import Link from 'next/link';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';

/** Footer link columns. Only pages that exist; add industry, free-tool and compare pages here as they ship. */
const FOOTER_COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Products',
    links: [
      { label: 'Billing & GST', href: '/#tour' },
      { label: 'Online store', href: '/#store' },
      { label: 'Store themes', href: '/themes' },
      { label: 'WhatsApp marketing', href: '/?product=connect' },
      { label: 'Staff & HR', href: '/?product=hr' },
    ],
  },
  {
    title: 'Features',
    links: [
      { label: 'Accounting', href: '/solution/accounting' },
      { label: 'Inventory', href: '/solution/inventory' },
      { label: 'GST reports', href: '/#tour' },
      { label: 'Bill designs', href: '/#templates' },
      { label: 'Pricing', href: '/#pricing' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { label: 'Blog', href: '/blog' },
      { label: 'Guides', href: '/guides' },
      { label: 'Questions', href: '/#faq' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About Khatario', href: '/about' },
      { label: 'Book a demo', href: '/book-demo' },
      { label: 'Partners', href: '/partners' },
      { label: 'Log in', href: '/login' },
      { label: 'Start free', href: '/signup' },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="bg-slate-950 pb-10 pt-16 text-slate-400">
      <div className={`${LANDING_PAGE_GUTTER} w-full`}>
        <div className="grid gap-10 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <Link href="/" className="inline-flex">
              <img src="/brand/khatario-wordmark-light.png" alt="Khatario" className="h-12 w-auto" />
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed">
              Billing, online store, WhatsApp marketing and staff management for Indian shops. Made in India.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-8 sm:grid-cols-4" aria-label="Footer">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-sm font-bold text-accent-300">{col.title}</p>
                <ul className="mt-3 space-y-2.5 text-sm">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} className="text-slate-300 hover:text-white">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-slate-800 pt-6 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Khatario. All rights reserved.</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Legal">
            <Link href="/privacy" className="text-slate-300 hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="text-slate-300 hover:text-white">
              Terms
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
