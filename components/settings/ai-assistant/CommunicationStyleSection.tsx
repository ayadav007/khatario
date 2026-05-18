'use client';

/**
 * Communication Style Section
 * 
 * Card-based selection for communication style (Friendly/Professional/Short/Detailed)
 * No free text input - preset choices only
 */

import React from 'react';
import { Card } from '@/components/ui/Card';
import { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import {
  CommunicationStyleOptions,
  CommunicationStyleOption,
  applyCommunicationStylePreset,
  getCommunicationStyleFromConfig,
} from '@/types/communication-style-presets';
import { CheckCircle2, Info } from 'lucide-react';

interface CommunicationStyleSectionProps {
  config: WhatsAppBotUIConfig;
  onUpdate: (updates: Partial<WhatsAppBotUIConfig>) => void;
}

export function CommunicationStyleSection({ config, onUpdate }: CommunicationStyleSectionProps) {
  const currentStyle = getCommunicationStyleFromConfig(config);

  const handleStyleSelect = (style: CommunicationStyleOption) => {
    if (style === currentStyle) return;
    const preset = applyCommunicationStylePreset(style, config);
    onUpdate(preset);
  };

  const options = [
    { key: 'friendly_casual' as CommunicationStyleOption, ...CommunicationStyleOptions.friendly_casual },
    { key: 'professional_formal' as CommunicationStyleOption, ...CommunicationStyleOptions.professional_formal },
    { key: 'short_direct' as CommunicationStyleOption, ...CommunicationStyleOptions.short_direct },
    { key: 'detailed_explanatory' as CommunicationStyleOption, ...CommunicationStyleOptions.detailed_explanatory },
  ];

  return (
    <Card padding="lg">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">Communication Style</h2>
          <p className="text-sm text-text-secondary">
            Choose how your assistant should communicate with customers. This affects tone, response length, and greeting style.
          </p>
        </div>

        {/* Card-Based Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {options.map((option) => {
            const isSelected = currentStyle === option.key;
            return (
              <button
                key={option.key}
                onClick={() => handleStyleSelect(option.key)}
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
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary mb-1">
                      {option.label}
                    </h3>
                    <p className="text-sm text-text-secondary">
                      {option.shortDescription}
                    </p>
                  </div>

                  {/* Examples */}
                  <div className="space-y-2 pt-3 border-t border-border">
                    <div className="text-xs font-medium text-text-muted uppercase mb-2">
                      Example Responses
                    </div>
                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-text-muted font-medium">Greeting:</span>
                        <div className="mt-1 p-2 bg-gray-50 dark:bg-slate-800/50 rounded text-text-secondary italic">
                          "{option.examples.greeting}"
                        </div>
                      </div>
                      <div>
                        <span className="text-text-muted font-medium">Product Inquiry:</span>
                        <div className="mt-1 p-2 bg-gray-50 dark:bg-slate-800/50 rounded text-text-secondary italic">
                          "{option.examples.productInquiry}"
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Tooltip Info */}
                  <div className="pt-2">
                    <div className="flex items-start gap-2 text-xs text-text-muted">
                      <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>{option.tooltip}</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
