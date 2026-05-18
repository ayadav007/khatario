'use client';

/**
 * Customers & Personalization Section
 * 
 * Simplified version using customerExperience settings from config
 * Note: Full customerHandling structure is not in WhatsAppBotUIConfig,
 * so we use customerExperience settings which are available
 */

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CustomersPersonalizationSectionProps {
  config: WhatsAppBotUIConfig;
  onUpdate: (updates: Partial<WhatsAppBotUIConfig>) => void;
}

export function CustomersPersonalizationSection({ config, onUpdate }: CustomersPersonalizationSectionProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['personalization']));
  
  const customerExperience = config.customerExperience || {
    enableUpselling: false,
    upsellingStyle: 'subtle',
    personalizeForReturningCustomers: true,
    enableTimeBasedGreetings: true,
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  const handleToggle = (key: keyof typeof customerExperience, value: boolean) => {
    onUpdate({
      customerExperience: {
        ...customerExperience,
        [key]: value,
      },
    });
  };

  const handleUpsellingStyleChange = (style: 'subtle' | 'moderate' | 'aggressive') => {
    onUpdate({
      customerExperience: {
        ...customerExperience,
        upsellingStyle: style,
      },
    });
  };

  return (
    <Card padding="lg">
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">Customers & Personalization</h2>
          <p className="text-sm text-text-secondary">
            Configure how the assistant personalizes interactions with customers.
          </p>
        </div>

        {/* Personalization Settings */}
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => toggleGroup('personalization')}
            className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors"
          >
            <div>
              <h3 className="font-semibold text-text-primary text-left">Personalization Settings</h3>
              <p className="text-sm text-text-secondary text-left mt-1">Configure how the assistant personalizes responses</p>
            </div>
            {expandedGroups.has('personalization') ? (
              <ChevronUp className="w-5 h-5 text-text-muted" />
            ) : (
              <ChevronDown className="w-5 h-5 text-text-muted" />
            )}
          </button>

          {expandedGroups.has('personalization') && (
            <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
              {/* Personalize for Returning Customers */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Personalize for Returning Customers
                  </label>
                  <p className="text-sm text-text-secondary">
                    Use customer name and purchase history to personalize responses
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={customerExperience.personalizeForReturningCustomers}
                    onChange={(e) => handleToggle('personalizeForReturningCustomers', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
                </label>
              </div>

              {/* Time-Based Greetings */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Time-Based Greetings
                  </label>
                  <p className="text-sm text-text-secondary">
                    Use "Good morning", "Good evening" based on time of day
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer ml-4">
                  <input
                    type="checkbox"
                    checked={customerExperience.enableTimeBasedGreetings}
                    onChange={(e) => handleToggle('enableTimeBasedGreetings', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
                </label>
              </div>

              {/* Upselling */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-text-primary mb-1">
                      Enable Upselling
                    </label>
                    <p className="text-sm text-text-secondary">
                      Suggest additional or related products to customers
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer ml-4">
                    <input
                      type="checkbox"
                      checked={customerExperience.enableUpselling}
                      onChange={(e) => handleToggle('enableUpselling', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
                  </label>
                </div>

                {customerExperience.enableUpselling && (
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Upselling Style
                    </label>
                    <div className="space-y-2">
                      {(['subtle', 'moderate', 'aggressive'] as const).map((style) => (
                        <label
                          key={style}
                          className={`
                            flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all
                            ${customerExperience.upsellingStyle === style
                              ? 'border-primary-500 bg-slate-50'
                              : 'border-border bg-surface hover:border-primary-500 dark:hover:border-primary-600'
                            }
                          `}
                        >
                          <input
                            type="radio"
                            name="upsellingStyle"
                            value={style}
                            checked={customerExperience.upsellingStyle === style}
                            onChange={() => handleUpsellingStyleChange(style)}
                            className="mt-1 w-4 h-4 text-primary-600 focus:ring-primary-500"
                          />
                          <div className="flex-1">
                            <div className="font-medium text-text-primary capitalize">{style}</div>
                            <div className="text-sm text-text-secondary">
                              {style === 'subtle' && 'Gentle suggestions when relevant'}
                              {style === 'moderate' && 'Regular suggestions for complementary items'}
                              {style === 'aggressive' && 'Frequent suggestions and promotions'}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
