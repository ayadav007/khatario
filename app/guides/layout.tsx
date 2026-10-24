import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Khatario Guides: GST Billing, Stock & Accounts How-tos' },
  description:
    'Step-by-step Khatario guides for GST billing, WhatsApp invoices, stock, purchases, accounts and GST returns. Free to read, no sign-in required.',
  alternates: { canonical: '/guides' },
};

export default function GuidesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
