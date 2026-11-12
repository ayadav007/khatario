'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { Search } from 'lucide-react';
import { HsnFinderTool } from '@/components/tools/HsnFinderTool';

export default function HSNFinderPage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <PageHeader
  title={<><Search className="w-6 h-6 text-primary-500" />
              GST HSN/SAC Finder Tool</>}
  subtitle="Search the most commonly used HSN codes and GST rates for Indian small businesses."
/>

      <HsnFinderTool />
    </div>
  );
}
