'use client';

export const dynamic = 'force-dynamic';

import { WorkflowBuilder } from '@/components/automation/WorkflowBuilder';
import { useAuth } from '@/contexts/AuthContext';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import Link from 'next/link';
import { ChevronRight, Zap } from 'lucide-react';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

function AutomationPage() {
  const { business } = useAuth();

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-text-secondary dark:text-text-muted">
        <Link href="/settings" className="hover:text-primary-600 dark:hover:text-primary-400 transition">
          Settings
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-text-primary dark:text-gray-100 font-medium">Automation</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-xl">
          <Zap className="w-6 h-6 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary dark:text-gray-100">Workflow Automation</h1>
          <p className="text-sm text-text-secondary dark:text-text-muted">Automate repetitive tasks and save time</p>
        </div>
      </div>

      {/* Workflow Builder Component */}
      <WorkflowBuilder businessId={business?.id || ''} />
    </div>
  );
}

export default withPageAuth('settings', 'read', AutomationPage);
