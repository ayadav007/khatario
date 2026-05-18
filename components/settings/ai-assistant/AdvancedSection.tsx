'use client';

/**
 * Advanced Section (Collapsed by default)
 * 
 * Structured custom instructions - no raw prompt editing
 */

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';

interface AdvancedSectionProps {
  config: WhatsAppBotUIConfig;
  onUpdate: (updates: Partial<WhatsAppBotUIConfig>) => void;
}

export function AdvancedSection({ config, onUpdate }: AdvancedSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const advanced = config.advanced || {};
  const customInstructions = advanced.customInstructions || '';

  const handleInstructionsChange = (instructions: string) => {
    if (instructions.length > 1000) return; // Limit to 1000 characters
    onUpdate({
      advanced: {
        ...advanced,
        customInstructions: instructions,
      },
    });
  };

  return (
    <Card padding="lg">
      <div className="space-y-4">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between"
        >
          <div className="text-left">
            <h2 className="text-xl font-semibold text-text-primary mb-1">Advanced</h2>
            <p className="text-sm text-text-secondary">
              Configure advanced behavior rules for the assistant.
            </p>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-text-muted" />
          ) : (
            <ChevronDown className="w-5 h-5 text-text-muted" />
          )}
        </button>

        {isExpanded && (
          <div className="space-y-4 border-t pt-4">
            {/* Custom Instructions */}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Custom Instructions
                </label>
                <p className="text-sm text-text-secondary mb-2">
                  Provide additional guidance for how the assistant should behave. 
                  These instructions will be considered when generating responses.
                </p>
              </div>
              <Textarea
                value={customInstructions}
                onChange={(e) => handleInstructionsChange(e.target.value)}
                rows={6}
                maxLength={1000}
                placeholder="Example: Always mention our free shipping policy for orders above ₹500..."
                helperText={`${customInstructions.length}/1000 characters`}
              />
              <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-primary-900">
                    <p className="font-medium mb-1">Guidelines</p>
                    <ul className="text-primary-700 space-y-1 list-disc list-inside">
                      <li>Keep instructions clear and specific</li>
                      <li>Focus on behavior, not technical details</li>
                      <li>Avoid contradicting other settings</li>
                      <li>These instructions supplement, not replace, your other configuration</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
