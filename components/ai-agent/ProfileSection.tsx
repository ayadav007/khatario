'use client';

import React from 'react';
import { RotateCcw, Store } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { INSTRUCTIONS_MAX, MESSAGE_MAX, type AgentSettings } from '@/lib/ai-agent/types';
import type { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import { CharCount, FieldLabel, SectionCard } from './SectionCard';

type Industry = NonNullable<NonNullable<WhatsAppBotUIConfig['advanced']>['industryTemplate']>;

export const INDUSTRY_OPTIONS: Array<{
  value: Industry;
  label: string;
  hint: string;
  customerType: WhatsAppBotUIConfig['businessType']['customerType'];
}> = [
  { value: 'retail', label: 'Retail shop', hint: 'Individual shoppers, small quantities, quick answers.', customerType: 'individual' },
  { value: 'wholesale', label: 'Wholesale / B2B', hint: 'Business buyers, bulk quantities, credit terms.', customerType: 'business' },
  { value: 'restaurant', label: 'Restaurant / food', hint: 'Menu questions, timings and quick orders.', customerType: 'individual' },
  { value: 'services', label: 'Services', hint: 'Appointments, enquiries and quotes.', customerType: 'individual' },
  { value: 'manufacturing', label: 'Manufacturing', hint: 'Dealers and end customers, specs and MOQ.', customerType: 'both' },
  { value: 'custom', label: 'Something else', hint: 'Describe your business in the summary.', customerType: 'both' },
];

export function applyIndustry(behavior: WhatsAppBotUIConfig, industry: Industry): WhatsAppBotUIConfig {
  const opt = INDUSTRY_OPTIONS.find((o) => o.value === industry);
  return {
    ...behavior,
    businessType: { ...behavior.businessType, customerType: opt?.customerType ?? behavior.businessType.customerType },
    advanced: { ...(behavior.advanced || {}), industryTemplate: industry },
  };
}

export function ProfileSection({
  settings,
  onChange,
  companyIntroduction,
}: {
  settings: AgentSettings;
  onChange: (patch: Partial<AgentSettings>) => void;
  companyIntroduction: string;
}) {
  const industry = settings.behavior.advanced?.industryTemplate ?? 'retail';
  const hint = INDUSTRY_OPTIONS.find((o) => o.value === industry)?.hint;

  return (
    <SectionCard
      id="profile"
      icon={Store}
      title="Business profile"
      description="What your agent knows about your business and how it introduces itself."
    >
      <div className="space-y-5">
        <div>
          <div className="mb-1.5 flex items-end justify-between gap-2">
            <FieldLabel hint="A few lines about what you sell, who you sell to and where.">Business summary</FieldLabel>
            {companyIntroduction && companyIntroduction !== settings.businessSummary && (
              <button
                type="button"
                onClick={() => onChange({ businessSummary: companyIntroduction.slice(0, INSTRUCTIONS_MAX) })}
                className="mb-1.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary-700 hover:underline"
              >
                <RotateCcw className="h-3 w-3" /> Refill from business profile
              </button>
            )}
          </div>
          <Textarea
            rows={4}
            value={settings.businessSummary}
            maxLength={INSTRUCTIONS_MAX}
            onChange={(e) => onChange({ businessSummary: e.target.value })}
            placeholder="We are a family-run grocery store in Pune selling fresh produce, staples and household items. We deliver within 5 km."
          />
          <CharCount value={settings.businessSummary} max={INSTRUCTIONS_MAX} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Agent name"
            value={settings.agentName}
            maxLength={120}
            onChange={(e) => onChange({ agentName: e.target.value })}
            placeholder="Sharma Stores Assistant"
          />
          <div>
            <FieldLabel>Business type</FieldLabel>
            <select
              className="input"
              value={industry}
              onChange={(e) => onChange({ behavior: applyIndustry(settings.behavior, e.target.value as Industry) })}
            >
              {INDUSTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {hint && <p className="mt-1 text-xs text-text-secondary">{hint}</p>}
          </div>
        </div>

        <div>
          <FieldLabel hint="Sent once when a new customer messages you for the first time. Leave blank to skip.">
            Greeting message (optional)
          </FieldLabel>
          <Textarea
            rows={2}
            value={settings.greetingMessage}
            maxLength={MESSAGE_MAX}
            onChange={(e) => onChange({ greetingMessage: e.target.value })}
            placeholder="Hi! 👋 Welcome to Sharma Stores. Ask me about prices, stock or delivery."
          />
        </div>

        <div>
          <FieldLabel hint="Rules the agent must always follow. Keep each rule on its own line.">Instructions</FieldLabel>
          <Textarea
            rows={6}
            value={settings.instructions}
            maxLength={INSTRUCTIONS_MAX}
            onChange={(e) => onChange({ instructions: e.target.value })}
            placeholder={'Always reply in the language the customer uses.\nFree delivery on orders above ₹500.\nNever promise same-day delivery after 6 pm.\nFor bulk orders above 50 units, ask the customer to call us.'}
          />
          <CharCount value={settings.instructions} max={INSTRUCTIONS_MAX} />
        </div>
      </div>
    </SectionCard>
  );
}
