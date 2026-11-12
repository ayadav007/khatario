import Link from 'next/link';
import { Facebook, Instagram, Linkedin, Twitter, Youtube } from 'lucide-react';
import type { ComponentType } from 'react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { getPublicSupportConfig } from '@/lib/marketing-public-config';
import { companyName, fact, socialLinks, telHref, type SocialNetwork } from '@/lib/marketing/company-facts';
import { FOOTER_COLUMNS, FOOTER_LEGAL_LINKS } from '@/lib/marketing/footer-links';

const SOCIAL_ICONS: Record<SocialNetwork, { Icon: ComponentType<{ className?: string }>; label: string }> = {
  instagram: { Icon: Instagram, label: 'Khatario on Instagram' },
  youtube: { Icon: Youtube, label: 'Khatario on YouTube' },
  facebook: { Icon: Facebook, label: 'Khatario on Facebook' },
  linkedin: { Icon: Linkedin, label: 'Khatario on LinkedIn' },
  x: { Icon: Twitter, label: 'Khatario on X' },
};

export function LandingFooter() {
  const { email } = getPublicSupportConfig();
  const phone = fact('phone');
  const phoneHref = phone ? telHref(phone) : null;
  const socials = socialLinks();
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
            {(email || (phone && phoneHref)) && (
              <p className="mt-4 space-y-1 text-sm">
                {email && (
                  <a href={`mailto:${email}`} className="block text-slate-300 hover:text-white">
                    {email}
                  </a>
                )}
                {phone && phoneHref && (
                  <a href={phoneHref} className="block text-slate-300 hover:text-white">
                    {phone}
                  </a>
                )}
              </p>
            )}
            {socials.length > 0 && (
              <ul className="mt-4 flex items-center gap-3">
                {socials.map(({ network, url }) => {
                  const { Icon, label } = SOCIAL_ICONS[network];
                  return (
                    <li key={network}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={label}
                        className="text-slate-300 hover:text-white"
                      >
                        <Icon className="h-5 w-5" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
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
          <p>© 2026 {companyName()}. All rights reserved.</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Legal">
            {FOOTER_LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="text-slate-300 hover:text-white">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
