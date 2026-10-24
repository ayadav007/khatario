import Link from 'next/link';
import { LandingFooter } from '@/components/marketing/landing/LandingFooter';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';

export function BlogShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <MarketingSiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      <div className="mx-auto w-full max-w-6xl px-4 pb-6 sm:px-6 lg:px-8">
        <Link href="/" className="text-sm font-medium text-teal-700 hover:text-teal-800">← Back to home</Link>
      </div>
      <LandingFooter />
    </div>
  );
}
