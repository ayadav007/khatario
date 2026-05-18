'use client';

import React from 'react';
import Link from 'next/link';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { HowToBlogAccordion } from '@/components/help/HowToBlogAccordion';

export default function PublicGuidesPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <MarketingSiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="mb-6 text-center text-sm text-slate-600 dark:text-slate-400">
          Already use Khatario?{' '}
          <Link href="/login" className="font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
            Sign in
          </Link>{' '}
          for the full app — these guides stay available here without an account.
        </p>
        <HowToBlogAccordion />
      </main>
      <footer className="border-t border-slate-200 bg-white py-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">
          <Link href="/" className="font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
            ← Back to home
          </Link>
        </div>
      </footer>
    </div>
  );
}
