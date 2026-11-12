'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { Tag } from 'lucide-react';
import { DiscountCalculatorTool } from '@/components/tools/DiscountCalculatorTool';

export default function DiscountCalculatorPage() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <PageHeader
  title={<><Tag className="w-6 h-6 text-primary-500" />
            Discount Calculator</>}
  subtitle="Calculate discounts and final prices for your products"
/>
        </div>

      <DiscountCalculatorTool />
    </div>
  );
}
