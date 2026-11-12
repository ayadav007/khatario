'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { TrendingUp } from 'lucide-react';
import { PriceMarginCalculatorTool } from '@/components/tools/PriceMarginCalculatorTool';

export default function PriceMarginCalculatorPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <PageHeader
  title={<><TrendingUp className="w-6 h-6 text-primary-500" />
            Price & Margin Calculator</>}
  subtitle="Calculate profit margins, markup, selling price, and cost price"
/>
        </div>

      <PriceMarginCalculatorTool />
    </div>
  );
}
