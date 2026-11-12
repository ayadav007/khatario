'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { Calendar } from 'lucide-react';
import { EmiCalculatorTool } from '@/components/tools/EmiCalculatorTool';

export default function EMICalculatorPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <PageHeader
  title={<><Calendar className="w-6 h-6 text-primary-500" />
            EMI Calculator</>}
  subtitle="Calculate Equated Monthly Installment (EMI) for loans"
/>
        </div>

      <EmiCalculatorTool />
    </div>
  );
}
