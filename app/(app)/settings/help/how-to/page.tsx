'use client';

import React from 'react';
import Link from 'next/link';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { HowToBlogAccordion } from '@/components/help/HowToBlogAccordion';

function HowToIndexPage() {
  return (
    <SettingsPageShell
      title="How-to guides"
      description="Step-by-step guides for common tasks in Khatario."
      icon={BookOpen}
    >
      <Link
        href="/settings/help"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Help &amp; Support
      </Link>
      <HowToBlogAccordion />
    </SettingsPageShell>
  );
}

export default withPageAuth('settings', 'read', HowToIndexPage);
