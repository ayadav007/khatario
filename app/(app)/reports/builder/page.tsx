'use client';

export const dynamic = 'force-dynamic';

import { ReportBuilder } from '@/components/reports/ReportBuilder';
import { useAuth } from '@/contexts/AuthContext';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

function ReportBuilderPage() {
  const { business } = useAuth();

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <Link href="/reports" className="hover:text-primary-600 dark:hover:text-primary-400 transition flex items-center gap-1">
          <ChevronLeft className="w-4 h-4" />
          Back to Reports
        </Link>
      </div>

      {/* Report Builder Component */}
      <ReportBuilder 
        businessId={business?.id || ''} 
        entityType="invoices" 
      />
    </div>
  );
}

export default withPageAuth('reports', 'read', ReportBuilderPage);
