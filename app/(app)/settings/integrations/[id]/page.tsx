'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PluginPage } from '@/components/settings/integrations/PluginPage';
import { getPluginEntry } from '@/lib/integrations/catalog';

export default function IntegrationPluginPage({ params }: { params: { id: string } }) {
  const entry = getPluginEntry(params.id);
  if (!entry) notFound();
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      }
    >
      <PluginPage entry={entry} />
    </Suspense>
  );
}
