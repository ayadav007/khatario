'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { CreditCard } from 'lucide-react';
import { PanValidatorTool } from '@/components/tools/PanValidatorTool';

export default function PANValidatorPage() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <PageHeader
  title={<><CreditCard className="w-6 h-6 text-primary-500" />
            PAN Card Validator</>}
  subtitle="Validate and verify PAN (Permanent Account Number) card format"
/>
        </div>

      <PanValidatorTool />
    </div>
  );
}
