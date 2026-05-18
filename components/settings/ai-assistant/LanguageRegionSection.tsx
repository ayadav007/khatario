'use client';

/**
 * Language & Region Section
 * 
 * Language selector, currency format, date & time format
 * Note: This is a simplified version - full implementation would integrate with i18n
 */

import React from 'react';
import { Card } from '@/components/ui/Card';
import { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import { Info } from 'lucide-react';

interface LanguageRegionSectionProps {
  config: WhatsAppBotUIConfig;
  onUpdate: (updates: Partial<WhatsAppBotUIConfig>) => void;
}

export function LanguageRegionSection({ config, onUpdate }: LanguageRegionSectionProps) {
  // Note: Language/Region settings are not currently in WhatsAppBotUIConfig
  // This section is a placeholder for future implementation
  // For now, we show informational content

  return (
    <Card padding="lg">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">Language & Region</h2>
          <p className="text-sm text-text-secondary">
            Configure language and regional formatting preferences.
          </p>
        </div>

        <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-primary-900">
              <p className="font-medium mb-1">Coming Soon</p>
              <p className="text-primary-700">
                Language and regional formatting settings will be available in a future update. 
                The assistant currently responds in the language you configure in your business settings.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
