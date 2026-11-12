'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { Building2 } from 'lucide-react';
import { GstinValidatorTool } from '@/components/tools/GstinValidatorTool';

export default function GSTINValidatorPage() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <PageHeader
  title={<><Building2 className="w-6 h-6 text-primary-500" />
            GSTIN Validator</>}
  subtitle="Validate and verify GSTIN (GST Identification Number) format"
/>
        </div>

      <GstinValidatorTool />
    </div>
  );
}
