import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Book a Free Khatario Demo | GST Billing App for Shops' },
  description: 'Pick a time for a free 20-minute walkthrough of Khatario: GST bills, WhatsApp invoices, stock and udhaar tracking for your shop.',
  alternates: { canonical: '/book-demo' },
};

export default function BookDemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
