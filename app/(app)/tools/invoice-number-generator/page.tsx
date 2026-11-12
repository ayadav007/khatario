'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { FileText } from 'lucide-react';
import { InvoiceNumberGeneratorTool } from '@/components/tools/InvoiceNumberGeneratorTool';

export default function InvoiceNumberGeneratorPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <PageHeader
  title={<><FileText className="w-6 h-6 text-primary-500" />
            Invoice Number Generator</>}
  subtitle="Generate sequential invoice numbers with custom formatting"
/>
        </div>

      <InvoiceNumberGeneratorTool />
    </div>
  );
}
