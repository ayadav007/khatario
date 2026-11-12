export type FooterLink = { label: string; href: string };

/** Footer link columns. Only pages that exist; add industry, free-tool and compare pages here as they ship. */
export const FOOTER_COLUMNS: { title: string; links: FooterLink[] }[] = [
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
      { label: 'Pricing', href: '/pricing' },
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
      { label: 'Contact', href: '/contact' },
      { label: 'Book a demo', href: '/book-demo' },
      { label: 'Partners', href: '/partners' },
      { label: 'Start free', href: '/signup' },
    ],
  },
];

export const FOOTER_LEGAL_LINKS: FooterLink[] = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Refund policy', href: '/refund-policy' },
  { label: 'Security', href: '/security' },
];
