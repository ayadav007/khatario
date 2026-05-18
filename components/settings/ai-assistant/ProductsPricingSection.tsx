'use client';

/**
 * Products & Pricing Display Section
 * 
 * Industry preset selector, checkbox list of fields
 * Note: Drag-to-reorder is simplified to checkbox selection for now
 */

import React from 'react';
import { Card } from '@/components/ui/Card';
import { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import {
  IndustryPresets,
  ProductFields,
  ProductField,
  IndustryPreset,
  applyIndustryPreset,
} from '@/types/product-info-presets';
import { Info } from 'lucide-react';

interface ProductsPricingSectionProps {
  config: WhatsAppBotUIConfig;
  onUpdate: (updates: Partial<WhatsAppBotUIConfig>) => void;
}

export function ProductsPricingSection({ config, onUpdate }: ProductsPricingSectionProps) {
  const productInfo = config.productInfo || {
    showFields: ['price', 'stock', 'description'],
    showOutOfStock: true,
    highlightBestSellers: false,
  };

  // Determine current preset based on selected fields
  const getCurrentPreset = (): IndustryPreset => {
    const fields = productInfo.showFields;
    if (JSON.stringify(fields) === JSON.stringify(IndustryPresets.food.defaultFields)) return 'food';
    if (JSON.stringify(fields) === JSON.stringify(IndustryPresets.retail.defaultFields)) return 'retail';
    if (JSON.stringify(fields) === JSON.stringify(IndustryPresets.services.defaultFields)) return 'services';
    return 'custom';
  };

  const currentPreset = getCurrentPreset();

  const handlePresetChange = (preset: IndustryPreset) => {
    if (preset === 'custom') return; // Don't change fields for custom
    
    const presetConfig = applyIndustryPreset(preset);
    onUpdate({
      productInfo: {
        showFields: presetConfig.selectedFields,
        showOutOfStock: presetConfig.showOutOfStock,
        highlightBestSellers: presetConfig.highlightBestSellers,
      },
    });
  };

  const handleFieldToggle = (field: ProductField) => {
    const newFields = productInfo.showFields.includes(field)
      ? productInfo.showFields.filter(f => f !== field)
      : [...productInfo.showFields, field];
    
    onUpdate({
      productInfo: {
        ...productInfo,
        showFields: newFields,
      },
    });
  };

  const handleToggle = (key: 'showOutOfStock' | 'highlightBestSellers', value: boolean) => {
    onUpdate({
      productInfo: {
        ...productInfo,
        [key]: value,
      },
    });
  };

  return (
    <Card padding="lg">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-text-primary mb-2">Products & Pricing Display</h2>
          <p className="text-sm text-text-secondary">
            Configure which product information to show and in what order.
          </p>
        </div>

        {/* Industry Preset Selector */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-text-primary">
            Industry Preset
          </label>
          <p className="text-sm text-text-secondary mb-3">
            Select a preset or customize fields manually
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {Object.values(IndustryPresets).map((preset) => (
              <button
                key={preset.value}
                onClick={() => handlePresetChange(preset.value)}
                className={`
                  p-4 rounded-lg border-2 text-left transition-all
                  ${currentPreset === preset.value
                    ? 'border-primary-500 bg-slate-50'
                    : 'border-border bg-surface hover:border-primary-500 dark:hover:border-primary-600'
                  }
                `}
              >
                <div className="font-medium text-text-primary mb-1">{preset.label}</div>
                <div className="text-xs text-text-secondary">{preset.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Field Selection */}
        <div className="space-y-3 border-t pt-4">
          <label className="block text-sm font-medium text-text-primary">
            Show Product Fields
          </label>
          <p className="text-sm text-text-secondary mb-3">
            Select which product information to display to customers
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.values(ProductFields).map((field) => (
              <label
                key={field.value}
                className="flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all hover:border-primary-500 dark:hover:border-primary-600"
                style={{
                  borderColor: productInfo.showFields.includes(field.value) ? '#3b82f6' : '#e5e7eb',
                  backgroundColor: productInfo.showFields.includes(field.value) ? '#eff6ff' : 'white',
                }}
              >
                <input
                  type="checkbox"
                  checked={productInfo.showFields.includes(field.value)}
                  onChange={() => handleFieldToggle(field.value)}
                  className="mt-1 w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-text-primary">{field.label}</div>
                  <div className="text-sm text-text-secondary">{field.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Additional Options */}
        <div className="space-y-4 border-t pt-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text-primary mb-1">
                Show Out of Stock Products
              </label>
              <p className="text-sm text-text-secondary">
                Display products even when they are out of stock
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer ml-4">
              <input
                type="checkbox"
                checked={productInfo.showOutOfStock}
                onChange={(e) => handleToggle('showOutOfStock', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
            </label>
          </div>

          <div className="flex items-start justify-between">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text-primary mb-1">
                Highlight Best Sellers
              </label>
              <p className="text-sm text-text-secondary">
                Emphasize best-selling or popular products in responses
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer ml-4">
              <input
                type="checkbox"
                checked={productInfo.highlightBestSellers}
                onChange={(e) => handleToggle('highlightBestSellers', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 dark:bg-slate-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
            </label>
          </div>
        </div>

        {/* Note about field order */}
        <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-primary-900">
              <p className="font-medium mb-1">Note</p>
              <p className="text-primary-700">
                Fields are displayed in the order they appear above. The assistant will prioritize showing information in this order when responding to customer queries.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
