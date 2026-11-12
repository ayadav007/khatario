'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { RefreshCw } from 'lucide-react';
import { CurrencyConverterTool } from '@/components/tools/CurrencyConverterTool';

export default function CurrencyConverterPage() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <PageHeader
  title={<><RefreshCw className="w-6 h-6 text-primary-500" />
              Currency Converter</>}
  subtitle="Convert between Indian Rupee and other currencies"
/>

      <CurrencyConverterTool />
    </div>
  );
}
