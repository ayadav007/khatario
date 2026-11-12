'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { FileText } from 'lucide-react';
import { TdsCalculatorTool } from '@/components/tools/TdsCalculatorTool';

export default function TDSCalculatorPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <PageHeader
  title={<><FileText className="w-6 h-6 text-primary-500" />
            TDS Calculator</>}
  subtitle="Calculate TDS (Tax Deducted at Source) on payments"
/>
        </div>

      <TdsCalculatorTool />
    </div>
  );
}
