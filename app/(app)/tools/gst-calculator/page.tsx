'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { Calculator } from 'lucide-react';
import { GstCalculatorTool } from '@/components/tools/GstCalculatorTool';

export default function GSTCalculatorPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <PageHeader
  title={<><Calculator className="w-6 h-6 text-primary-500" />
            GST Calculator</>}
  subtitle="Calculate GST (CGST, SGST, IGST) on any amount"
/>
        </div>

      <GstCalculatorTool />
    </div>
  );
}
