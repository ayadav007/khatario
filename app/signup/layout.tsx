import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Sign Up Free | Khatario GST Billing & Stock App' },
  description: 'Create your free Khatario account and make your first GST bill in minutes. Works on phone and computer, no card needed.',
  alternates: { canonical: '/signup' },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
