'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { BookOpen, ExternalLink, Settings, Sparkles } from 'lucide-react';
import { PRODUCT_TOUR_CHAIN_PROFILE_SESSION_KEY } from '@/components/onboarding/productTourShared';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

function HelpSettingsPage() {
  const router = useRouter();

  /** Same as sidebar “Menu & profile tour”: main menu spotlight, then Business profile */
  const startMenuAndProfileTour = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(PRODUCT_TOUR_CHAIN_PROFILE_SESSION_KEY, '1');
    }
    router.push('/dashboard?product_tour=start');
  };

  const startSidebarOnlyTour = () => {
    router.push('/dashboard?product_tour=start');
  };

  const startBusinessProfileTour = () => {
    router.push('/settings/business?business_profile_tour=start');
  };

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-8`}>
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-text-primary">Help & Support</h1>
        <p className="text-base text-text-secondary max-w-3xl leading-relaxed">
          Get comfortable with Khatario — take the guided tour any time, or jump straight into settings.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-primary-100/80 bg-gradient-to-br from-slate-50/90 via-white to-accent-50/40 p-6 shadow-medium sm:p-8 dark:border-primary-800/50 dark:from-slate-900/95 dark:via-slate-900 dark:to-slate-800/90">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary-200/30 blur-3xl dark:bg-primary-600/20"
          aria-hidden
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/25 dark:shadow-primary-900/40">
            <Sparkles className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">Guided walkthrough</p>
            <h2 className="text-xl font-bold text-text-primary mb-2">Product tour</h2>
            <p className="text-sm leading-relaxed text-text-secondary mb-6">
              <span className="font-medium text-text-primary">Menu &amp; profile</span> walks the main navigation, then
              opens Business profile and explains each section. Use{' '}
              <span className="font-medium text-text-primary">Sidebar only</span> for a quick menu recap, or{' '}
              <span className="font-medium text-text-primary">Profile only</span> if you only need company settings.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                type="button"
                size="lg"
                className="rounded-full px-8 text-white !text-white shadow-lg shadow-primary-500/20 dark:shadow-primary-900/50"
                onClick={startMenuAndProfileTour}
              >
                Menu &amp; profile tour
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="rounded-full px-8 border-primary-200 bg-white/80 !text-primary-800 hover:bg-slate-100/90 dark:border-primary-500/50 dark:bg-slate-800/80 dark:!text-primary-100 dark:hover:bg-slate-800/90"
                onClick={startSidebarOnlyTour}
              >
                Sidebar only
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="rounded-full px-8 border-primary-200 bg-white/80 !text-primary-800 hover:bg-slate-100/90 dark:border-primary-500/50 dark:bg-slate-800/80 dark:!text-primary-100 dark:hover:bg-slate-800/90"
                onClick={startBusinessProfileTour}
              >
                Business profile only
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden border border-primary-200/60 bg-slate-100/50 p-6 shadow-small dark:border-primary-800/50 dark:bg-primary-950/20 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-primary-700 dark:bg-slate-800/50 dark:text-primary-300">
            <BookOpen className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-text-primary mb-1.5">How-to guides</h2>
            <p className="text-sm leading-relaxed text-text-secondary mb-4">
              Walkthroughs for first-time setup, chart of accounts, expenses on account, balance sheet, cash flow, and
              more — with optional space for your own screenshots. The same guides are available at{' '}
              <Link href="/guides" className="font-medium text-primary-600 hover:text-primary-700">
                /guides
              </Link>{' '}
              without signing in.
            </p>
            <Link
              href="/settings/help/how-to"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:text-primary-700"
            >
              Open how-to guides
              <ExternalLink className="w-4 h-4 opacity-80" />
            </Link>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden border-border p-6 shadow-small sm:p-7">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-background text-primary-600 ring-1 ring-border">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-1.5">Settings</h2>
            <p className="text-sm leading-relaxed text-text-secondary mb-4">
              Most configuration lives under <span className="font-medium text-text-primary">Settings</span> in the
              sidebar — business profile, templates, tax, users, subscription, and more.
            </p>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:text-primary-700"
            >
              Open settings overview
              <ExternalLink className="w-4 h-4 opacity-80" />
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default withPageAuth('settings', 'read', HelpSettingsPage);
