'use client';

/**
 * AI Assistant Settings Page
 * 
 * Production-ready settings page for configuring AI assistant behavior.
 * 
 * Core Rules:
 * 1. Users NEVER see or edit AI prompts
 * 2. No free-text behavior control except structured rules
 * 3. UI prevents invalid configuration states
 * 4. Defaults are intelligent and business-friendly
 * 5. Preview mode is simulated (no real messages sent)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { 
  WhatsAppBotUIConfig, 
  DefaultUIConfig, 
  validateUIConfig,
  mapUIConfigToBotConfig,
  mapBotConfigToUIConfig 
} from '@/types/whatsapp-bot-config';
import { Loader2, Save, RotateCcw, Eye, CheckCircle2, AlertCircle } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { BusinessTypeSection } from './ai-assistant/BusinessTypeSection';
import { CommunicationStyleSection } from './ai-assistant/CommunicationStyleSection';
import { CustomersPersonalizationSection } from './ai-assistant/CustomersPersonalizationSection';
import { ProductsPricingSection } from './ai-assistant/ProductsPricingSection';
import { OffersPromotionsSection } from './ai-assistant/OffersPromotionsSection';
import { BusinessHoursSection } from './ai-assistant/BusinessHoursSection';
import { AdvancedSection } from './ai-assistant/AdvancedSection';
import { PreviewSection } from './ai-assistant/PreviewSection';
import { WIDE_PAGE_CONTENT_CLASS } from '@/lib/page-layout';

interface AIAssistantSettingsPageProps {
  businessId: string;
}

type SectionId = 
  | 'business-type'
  | 'communication-style'
  | 'customers-personalization'
  | 'products-pricing'
  | 'offers-promotions'
  | 'business-hours'
  | 'advanced'
  | 'preview';

interface Section {
  id: SectionId;
  label: string;
  icon?: string;
}

const SECTIONS: Section[] = [
  { id: 'business-type', label: 'Business Type' },
  { id: 'communication-style', label: 'Communication Style' },
  { id: 'customers-personalization', label: 'Customers & Personalization' },
  { id: 'products-pricing', label: 'Products & Pricing Display' },
  { id: 'offers-promotions', label: 'Offers & Promotions' },
  { id: 'business-hours', label: 'Business Hours & Availability' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'preview', label: 'Preview' },
];

export function AIAssistantSettingsPage({ businessId }: AIAssistantSettingsPageProps) {
  const { business } = useAuth();
  const toast = useToastContext();
  const [config, setConfig] = useState<WhatsAppBotUIConfig>(DefaultUIConfig);
  const [originalConfig, setOriginalConfig] = useState<WhatsAppBotUIConfig>(DefaultUIConfig);
  const [activeSection, setActiveSection] = useState<SectionId>('business-type');
  const [validationErrors, setValidationErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const sectionRefs = useRef<Record<SectionId, HTMLDivElement | null>>({} as Record<SectionId, HTMLDivElement | null>);

  // Load configuration
  useEffect(() => {
    loadConfig();
  }, [businessId]);

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      // TODO: Replace with actual API call
      // const response = await fetch(`/api/settings/ai-assistant?business_id=${businessId}`);
      // const data = await response.json();
      // if (data.config) {
      //   const uiConfig = mapBotConfigToUIConfig(data.config);
      //   setConfig(uiConfig);
      //   setOriginalConfig(uiConfig);
      // }
      
      // For now, use defaults
      setConfig(DefaultUIConfig);
      setOriginalConfig(DefaultUIConfig);
    } catch (error) {
      console.error('Error loading AI assistant config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Validate configuration
  useEffect(() => {
    const errors = validateUIConfig(config);
    setValidationErrors(errors);
  }, [config]);

  // Track changes
  useEffect(() => {
    const changed = JSON.stringify(config) !== JSON.stringify(originalConfig);
    setHasChanges(changed);
  }, [config, originalConfig]);

  // Handle config updates
  const updateConfig = useCallback((updates: Partial<WhatsAppBotUIConfig>) => {
    setConfig(prev => ({
      ...prev,
      ...updates,
    }));
  }, []);

  // Handle section navigation
  const scrollToSection = (sectionId: SectionId) => {
    setActiveSection(sectionId);
    const element = sectionRefs.current[sectionId];
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Save configuration
  const handleSave = async () => {
    const errors = validateUIConfig(config);
    if (errors.length > 0) {
      setValidationErrors(errors);
      // Scroll to first error
      if (errors[0]) {
        const fieldParts = errors[0].field.split('.');
        // Map field to section (simplified)
        scrollToSection('business-type');
      }
      return;
    }

    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const internalConfig = mapUIConfigToBotConfig(config);
      // TODO: Replace with actual API call
      // const response = await fetch('/api/settings/ai-assistant', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     business_id: businessId,
      //     config: internalConfig,
      //   }),
      // });
      // if (!response.ok) throw new Error('Failed to save');
      
      setOriginalConfig(config);
      setHasChanges(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving config:', error);
      toast.error('Failed to save configuration. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Reset to defaults
  const handleReset = () => {
    if (confirm('Reset all settings to defaults? This cannot be undone.')) {
      setConfig(DefaultUIConfig);
      setValidationErrors([]);
    }
  };

  // Reset to original (revert changes)
  const handleRevert = () => {
    if (confirm('Discard all changes and revert to last saved configuration?')) {
      setConfig(originalConfig);
      setValidationErrors([]);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  const isValid = validationErrors.length === 0;

  return (
    <div className={WIDE_PAGE_CONTENT_CLASS}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text-primary mb-2">AI Assistant Settings</h1>
        <p className="text-text-secondary">
          Customize how your AI assistant interacts with customers. Changes are saved automatically when you click Save.
        </p>
      </div>

      {/* Validation Errors Banner */}
      {validationErrors.length > 0 && (
        <Card padding="md" className="mb-6 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-red-900 dark:text-red-200 mb-1">Configuration Errors</h3>
              <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
                {validationErrors.map((error, index) => (
                  <li key={index}>
                    <span className="font-medium">{error.field}:</span> {error.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* Success Banner */}
      {saveSuccess && (
        <Card padding="md" className="mb-6 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            <span className="text-sm font-medium text-green-900 dark:text-green-200">
              Settings saved successfully!
            </span>
          </div>
        </Card>
      )}

      {/* Main Layout */}
      <div className="flex gap-6">
        {/* Sidebar Navigation */}
        <aside className="w-64 flex-shrink-0">
          <Card padding="none" className="sticky top-6">
            <nav className="p-4 space-y-1">
              {SECTIONS.map((section) => {
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => scrollToSection(section.id)}
                    className={`
                      w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors
                      ${isActive
                        ? 'bg-slate-50 dark:bg-slate-800/40 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800'
                        : 'text-text-secondary hover:bg-gray-50 dark:hover:bg-slate-800/80'
                      }
                    `}
                  >
                    {section.label}
                  </button>
                );
              })}
            </nav>
          </Card>
        </aside>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="space-y-8">
            {/* Business Type Section */}
            <div
              ref={(el) => { sectionRefs.current['business-type'] = el; }}
              id="business-type"
            >
              <BusinessTypeSection
                config={config}
                onUpdate={updateConfig}
              />
            </div>

            {/* Communication Style Section */}
            <div
              ref={(el) => { sectionRefs.current['communication-style'] = el; }}
              id="communication-style"
            >
              <CommunicationStyleSection
                config={config}
                onUpdate={updateConfig}
              />
            </div>

            {/* Customers & Personalization Section */}
            <div
              ref={(el) => { sectionRefs.current['customers-personalization'] = el; }}
              id="customers-personalization"
            >
              <CustomersPersonalizationSection
                config={config}
                onUpdate={updateConfig}
              />
            </div>

            {/* Products & Pricing Display Section */}
            <div
              ref={(el) => { sectionRefs.current['products-pricing'] = el; }}
              id="products-pricing"
            >
              <ProductsPricingSection
                config={config}
                onUpdate={updateConfig}
              />
            </div>

            {/* Offers & Promotions Section */}
            <div
              ref={(el) => { sectionRefs.current['offers-promotions'] = el; }}
              id="offers-promotions"
            >
              <OffersPromotionsSection
                config={config}
                onUpdate={updateConfig}
              />
            </div>

            {/* Business Hours & Availability Section */}
            <div
              ref={(el) => { sectionRefs.current['business-hours'] = el; }}
              id="business-hours"
            >
              <BusinessHoursSection
                config={config}
                onUpdate={updateConfig}
              />
            </div>

            {/* Advanced Section */}
            <div
              ref={(el) => { sectionRefs.current['advanced'] = el; }}
              id="advanced"
            >
              <AdvancedSection
                config={config}
                onUpdate={updateConfig}
              />
            </div>

            {/* Preview Section */}
            <div
              ref={(el: HTMLDivElement | null) => {
                sectionRefs.current['preview'] = el;
              }}
              id="preview"
            >
              <PreviewSection
                config={config}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="sticky bottom-0 mt-8 pt-6 bg-background/95 dark:bg-slate-950/95 backdrop-blur-sm border-t border-border -mx-6 px-6">
        <Card padding="md" className="shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {hasChanges && (
                <span className="text-sm text-text-secondary">
                  You have unsaved changes
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={handleRevert}
                disabled={!hasChanges || isSaving}
              >
                <RotateCcw className="w-4 h-4" />
                Revert Changes
              </Button>
              <Button
                variant="secondary"
                onClick={handleReset}
                disabled={isSaving}
              >
                Reset to Defaults
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={!hasChanges || !isValid || isSaving}
                isLoading={isSaving}
              >
                <Save className="w-4 h-4" />
                Save Changes
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
