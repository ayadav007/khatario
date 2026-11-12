'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { TrendingUp } from 'lucide-react';
import { InterestCalculatorTool } from '@/components/tools/InterestCalculatorTool';

export default function InterestCalculatorPage() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <PageHeader
  title={<><TrendingUp className="w-6 h-6 text-primary-500" />
            Interest Calculator</>}
  subtitle="Calculate interest on overdue invoices, loans, or any amount"
/>
        </div>

      <InterestCalculatorTool />
    </div>
  );
}
