'use client';

import React from 'react';
import Link from 'next/link';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { ArrowLeft } from 'lucide-react';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';
import { HowToBlogAccordion } from '@/components/help/HowToBlogAccordion';

function HowToIndexPage() {
  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} py-2`}>
      <nav className="mb-6 text-sm text-slate-500 dark:text-slate-400" aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/settings/help" className="text-primary-600 hover:text-primary-700 dark:text-primary-400">
              Help
            </Link>
          </li>
          <li aria-hidden className="text-slate-400">
            /
          </li>
          <li className="font-medium text-slate-700 dark:text-slate-300">How-to guides</li>
        </ol>
        <Link
          href="/settings/help"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Help &amp; Support
        </Link>
      </nav>
      <HowToBlogAccordion />
    </div>
  );
}

export default withPageAuth('settings', 'read', HowToIndexPage);
