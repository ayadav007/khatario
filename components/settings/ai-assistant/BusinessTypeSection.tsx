'use client';

/**
 * Business Type Section
 * 
 * Radio card selector for business type (Retail/Wholesale/Both)
 * Auto-applies recommended defaults when a type is selected
 */

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import { 
  BusinessTypeOptions, 
  BusinessTypePresets, 
  applyBusinessTypePreset,
  BusinessTypeOption 
} from '@/types/business-type-presets';
import { CheckCircle2, Info } from 'lucide-react';

interface BusinessTypeSectionProps {
  config: WhatsAppBotUIConfig;
  onUpdate: (updates: Partial<WhatsAppBotUIConfig>) => void;
}

export function BusinessTypeSection({ config, onUpdate }: BusinessTypeSectionProps) {
  const [showAppliedIndicator, setShowAppliedIndicator] = useState(false);
  const [appliedType, setAppliedType] = useState<BusinessTypeOption | null>(null);

  // Map UI config customerType to business type option
  const getCurrentBusinessType = (): BusinessTypeOption => {
    const customerType = config.businessType.customerType;
    if (customerType === 'individual') return 'retail';
    if (customerType === 'business') return 'wholesale';
    return 'both';
  };

  const currentType = getCurrentBusinessType();

  const handleTypeSelect = (type: BusinessTypeOption) => {
    if (type === currentType) return;

    // Apply preset
    const preset = applyBusinessTypePreset(type, config);
    onUpdate(preset);

    // Show indicator
    setAppliedType(type);
    setShowAppliedIndicator(true);
    setTimeout(() => setShowAppliedIndicator(false), 3000);
  };

  const options = [
    { key: 'retail' as BusinessTypeOption, ...BusinessTypeOptions.retail },
    { key: 'wholesale' as BusinessTypeOption, ...BusinessTypeOptions.wholesale },
    { key: 'both' as BusinessTypeOption, ...BusinessTypeOptions.both },
  ];

  return (
    <Card padding="lg">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">Business Type</h2>
          <p className="text-sm text-text-secondary">
            Select the type of customers you serve. This will automatically configure the assistant's communication style, payment options, and ordering process.
          </p>
          {showAppliedIndicator && appliedType && (
            <div className="mt-3 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Recommended settings applied for {BusinessTypeOptions[appliedType].label}</span>
            </div>
          )}
        </div>

        {/* Radio Card Selector */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {options.map((option) => {
            const isSelected = currentType === option.key;
            return (
              <button
                key={option.key}
                onClick={() => handleTypeSelect(option.key)}
                className={`
                  relative text-left p-6 rounded-xl border-2 transition-all
                  ${isSelected
                    ? 'border-primary-500 bg-slate-50 shadow-sm'
                    : 'border-border bg-surface hover:border-primary-500 dark:hover:border-primary-600 hover:shadow-sm'
                  }
                `}
              >
                {/* Selection Indicator */}
                {isSelected && (
                  <div className="absolute top-4 right-4">
                    <div className="w-6 h-6 bg-primary-500 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    </div>
                  </div>
                )}

                {/* Content */}
                <div className="space-y-3">
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary mb-1">
                      {option.label}
                    </h3>
                    <p className="text-sm text-text-secondary">
                      {option.description}
                    </p>
                  </div>

                  {/* Recommendations */}
                  <div className="pt-3 border-t border-border">
                    <div className="flex items-start gap-2 mb-2">
                      <Info className="w-4 h-4 text-text-muted mt-0.5 flex-shrink-0" />
                      <span className="text-xs font-medium text-text-muted uppercase">
                        Recommended Settings
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {option.recommendations.slice(0, 3).map((rec, index) => (
                        <li key={index} className="text-xs text-text-secondary flex items-start gap-2">
                          <span className="text-primary-500 mt-1">•</span>
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Helper Text */}
        <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-primary-900">
              <p className="font-medium mb-1">You can customize these settings later</p>
              <p className="text-primary-700">
                After selecting a business type, you can fine-tune individual settings in other sections. The recommended settings are just a starting point.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
