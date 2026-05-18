'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import AIConfigTab from '@/components/settings/AIConfigTab';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronRight, Loader2 } from 'lucide-react';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

export default function AIConfigPage() {
  const { business } = useAuth();

  if (!business) {
    return (
      
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      
    );
  }

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/settings" className="hover:text-primary-600 transition">
          Settings
        </Link>
        <ChevronRight className="w-4 h-4" />
        <Link href="/settings/integrations?category=ai" className="hover:text-primary-600 transition">
          Integrations & Marketplace
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-text-primary font-medium">AI Sales Agent</span>
      </div>
      <AIConfigTab businessId={business.id} />
    </div>
  );
}
