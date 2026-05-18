'use client';

export const dynamic = 'force-dynamic';

import { WhatsAppTab } from '@/components/settings/WhatsAppTab';
import Link from 'next/link';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

export default function WhatsAppSettingsPage() {
  return (
    
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/settings" className="hover:text-primary-600 transition">
            Settings
          </Link>
          <ChevronRight className="w-4 h-4" />
          <Link
            href="/settings/integrations?category=whatsapp"
            className="hover:text-primary-600 transition"
          >
            Integrations & Marketplace
          </Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">WhatsApp</span>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-green-100 rounded-xl">
            <MessageSquare className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">WhatsApp Integration</h1>
            <p className="text-sm text-text-secondary">Send invoices and documents via WhatsApp</p>
          </div>
        </div>

        {/* Existing Component */}
        <WhatsAppTab />
      </div>
    
  );
}

