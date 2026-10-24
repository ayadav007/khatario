import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Log In | Khatario' },
  description: 'Log in to Khatario to make GST bills, share invoices on WhatsApp and manage stock.',
  alternates: { canonical: '/login' },
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
