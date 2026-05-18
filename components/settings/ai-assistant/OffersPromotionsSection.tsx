'use client';

/**
 * Offers & Promotions Section
 * 
 * Toggle: auto-mention offers
 * Radio: Always / Only when customer asks about price
 * Checkbox: highlight expiring offers
 */

import React from 'react';
import { Card } from '@/components/ui/Card';
import { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import {
  OfferVisibilityModes,
  mapOffersToInternalConfig,
  OffersPromotionsFieldCopy,
} from '@/types/offers-promotions-presets';
import { Info } from 'lucide-react';

interface OffersPromotionsSectionProps {
  config: WhatsAppBotUIConfig;
  onUpdate: (updates: Partial<WhatsAppBotUIConfig>) => void;
}

export function OffersPromotionsSection({ config, onUpdate }: OffersPromotionsSectionProps) {
  const promotions = config.promotions || {
    autoMentionActiveOffers: true,
    highlightDiscounts: true,
    showExpiryDates: false,
  };

  const handleAutoMentionChange = (enabled: boolean) => {
    onUpdate({
      promotions: {
        ...promotions,
        autoMentionActiveOffers: enabled,
      },
    });
  };

  const handleShowOffersWhenChange = (mode: 'always' | 'on_price_inquiry') => {
    onUpdate({
      promotions: {
        ...promotions,
        autoMentionActiveOffers: true,
        highlightDiscounts: mode === 'always',
      },
    });
  };

  const handleHighlightExpiringChange = (enabled: boolean) => {
    onUpdate({
      promotions: {
        ...promotions,
        showExpiryDates: enabled,
      },
    });
  };

  // Determine current showOffersWhen value
  const showOffersWhen = promotions.autoMentionActiveOffers
    ? (promotions.highlightDiscounts ? 'always' : 'on_price_inquiry')
    : 'always';

  return (
    <Card padding="lg">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">Offers & Promotions</h2>
          <p className="text-sm text-text-secondary">
            Configure how the assistant mentions and displays offers and promotions to customers.
          </p>
        </div>

        {/* Disclaimer */}
        <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-primary-900">
              <p className="font-medium mb-1">Note</p>
              <p className="text-primary-700">
                This controls when and how offers are shown. To create or manage offers, use the Promotions section in Settings.
              </p>
            </div>
          </div>
        </div>

        {/* Auto-Mention Toggle */}
        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text-primary mb-1">
                {OffersPromotionsFieldCopy.fieldLabels.autoMention}
              </label>
              <p className="text-sm text-text-secondary">
                {OffersPromotionsFieldCopy.fieldLabels.autoMentionDescription}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer ml-4">
              <input
                type="checkbox"
                checked={promotions.autoMentionActiveOffers}
                onChange={(e) => handleAutoMentionChange(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
            </label>
          </div>
          <p className="text-xs text-text-muted ml-1">
            {OffersPromotionsFieldCopy.helpText.autoMention}
          </p>
        </div>

        {/* Show Offers When (Conditional) */}
        {promotions.autoMentionActiveOffers && (
          <div className="space-y-3 border-t pt-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                {OffersPromotionsFieldCopy.fieldLabels.showOffersWhen}
              </label>
              <p className="text-sm text-text-secondary mb-3">
                {OffersPromotionsFieldCopy.fieldLabels.showOffersWhenDescription}
              </p>
            </div>
            <div className="space-y-2">
              {Object.values(OfferVisibilityModes).map((mode) => (
                <label
                  key={mode.value}
                  className={`
                    flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                    ${showOffersWhen === mode.value
                      ? 'border-primary-500 bg-slate-50'
                      : 'border-border bg-surface hover:border-primary-500 dark:hover:border-primary-600'
                    }
                  `}
                >
                  <input
                    type="radio"
                    name="showOffersWhen"
                    value={mode.value}
                    checked={showOffersWhen === mode.value}
                    onChange={() => handleShowOffersWhenChange(mode.value as 'always' | 'on_price_inquiry')}
                    className="mt-1 w-4 h-4 text-primary-600 focus:ring-primary-500"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-text-primary mb-1">{mode.label}</div>
                    <div className="text-sm text-text-secondary">{mode.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Highlight Expiring Offers Toggle */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text-primary mb-1">
                {OffersPromotionsFieldCopy.fieldLabels.highlightExpiring}
              </label>
              <p className="text-sm text-text-secondary">
                {OffersPromotionsFieldCopy.fieldLabels.highlightExpiringDescription}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer ml-4">
              <input
                type="checkbox"
                checked={promotions.showExpiryDates}
                onChange={(e) => handleHighlightExpiringChange(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
            </label>
          </div>
          <p className="text-xs text-text-muted ml-1">
            {OffersPromotionsFieldCopy.helpText.highlightExpiring}
          </p>
        </div>
      </div>
    </Card>
  );
}
