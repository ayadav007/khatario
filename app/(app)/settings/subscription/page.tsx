'use client';

import { Suspense } from 'react';
import { SubscriptionTab } from '@/components/settings/SubscriptionTab';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { ChevronRight, Globe } from 'lucide-react';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

export const dynamic = 'force-dynamic';

export default function SubscriptionSettingsPage() {
  const { business } = useAuth();

  return (
    
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/settings" className="hover:text-primary-600 transition">Settings</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-muted">Integrations & Apps</span>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">Subscription & Billing</span>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-100 rounded-xl">
            <Globe className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Subscription & Billing</h1>
            <p className="text-sm text-text-secondary">Manage your plan and billing information</p>
          </div>
        </div>

        {/* Existing Component */}
        {business?.id && (
          <Suspense
            fallback={
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              </div>
            }
          >
            <SubscriptionTab businessId={business.id} />
          </Suspense>
        )}
      </div>
    
  );
}

