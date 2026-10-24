'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, MessageCircle } from 'lucide-react';
import { useAdmin } from '@/context/AdminContext';
import { AdsTab } from './_components/AdsTab';
import { FlowTab } from './_components/FlowTab';
import { MediaTab } from './_components/MediaTab';
import { MetricsTab } from './_components/MetricsTab';
import { PipelineTab } from './_components/PipelineTab';
import { TemplatesTab } from './_components/TemplatesTab';

const TABS = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'flow', label: 'Flow' },
  { id: 'media', label: 'Media' },
  { id: 'templates', label: 'Templates' },
  { id: 'ads', label: 'Ads' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function SalesFlowAdmin() {
  const router = useRouter();
  const params = useSearchParams();
  const { isMinimumRole } = useAdmin();
  const raw = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : 'pipeline';
  const canEdit = isMinimumRole('admin');

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-3 text-2xl font-bold text-gray-900 sm:text-3xl">
          <MessageCircle className="h-8 w-8 text-primary-600" />
          WhatsApp Sales Flow
        </h1>
        <p className="mt-2 text-gray-600">
          Leads from Meta click-to-WhatsApp ads: qualification, demo, free trial and follow-ups up to the first invoice and paid plan.
        </p>
      </div>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => router.replace(`/admin/sales-flow?tab=${t.id}`)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'metrics' && <MetricsTab />}
      {tab === 'flow' && <FlowTab canEdit={canEdit} />}
      {tab === 'media' && <MediaTab canEdit={canEdit} />}
      {tab === 'templates' && <TemplatesTab canEdit={canEdit} />}
      {tab === 'ads' && <AdsTab canEdit={canEdit} />}
    </div>
  );
}

export default function AdminSalesFlowPage() {
  return (
    <Suspense fallback={<div className="p-8"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>}>
      <SalesFlowAdmin />
    </Suspense>
  );
}
