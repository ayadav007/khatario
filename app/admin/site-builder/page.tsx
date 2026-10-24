'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import '@puckeditor/core/puck.css';

const SiteBuilderEditor = dynamic(
  () => import('@/components/marketing/builder/SiteBuilderEditor').then((m) => m.SiteBuilderEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    ),
  },
);

export default function SiteBuilderPage() {
  return <SiteBuilderEditor />;
}
