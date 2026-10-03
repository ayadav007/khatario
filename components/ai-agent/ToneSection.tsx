'use client';

import React from 'react';
import { CheckCircle2, MessageCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { Switch } from '@/components/ui/Switch';
import type { WhatsAppBotUIConfig } from '@/types/whatsapp-bot-config';
import { SectionCard } from './SectionCard';

type Tone = WhatsAppBotUIConfig['communicationStyle']['tone'];
type Length = WhatsAppBotUIConfig['communicationStyle']['responseLength'];

const TONES: Array<{ value: Tone; label: string; description: string; example: string }> = [
  {
    value: 'friendly_casual',
    label: 'Friendly',
    description: 'Warm and conversational, light emojis.',
    example: "Hi! 👋 Yes, we have it — ₹500 and in stock. Want me to add it?",
  },
  {
    value: 'professional_formal',
    label: 'Professional',
    description: 'Polite and businesslike, no slang.',
    example: 'Good afternoon. The item is available at ₹500. Shall I place the order for you?',
  },
  {
    value: 'helpful_expert',
    label: 'Expert',
    description: 'Knowledgeable, explains options and trade-offs.',
    example: 'The 1 kg pack is ₹500 and better value than two 500 g packs. It keeps for 6 months.',
  },
  {
    value: 'efficient_direct',
    label: 'Direct',
    description: 'Short answers, straight to the point.',
    example: '₹500, in stock. Order now?',
  },
];

const LENGTHS: Array<{ value: Length; label: string; description: string }> = [
  { value: 'brief', label: 'Short', description: '1–2 sentences' },
  { value: 'moderate', label: 'Medium', description: '2–4 sentences' },
  { value: 'detailed', label: 'Detailed', description: 'Full explanations' },
];

function OptionCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'relative rounded-xl border-2 p-4 text-left transition-all',
        selected
          ? 'border-primary-500 bg-primary-50/60 shadow-sm dark:bg-primary-900/20'
          : 'border-border bg-surface hover:border-primary-400',
      )}
    >
      {selected && <CheckCircle2 className="absolute right-3 top-3 h-5 w-5 text-primary-600" />}
      {children}
    </button>
  );
}

export function ToneSection({
  behavior,
  onChange,
}: {
  behavior: WhatsAppBotUIConfig;
  onChange: (behavior: WhatsAppBotUIConfig) => void;
}) {
  const style = behavior.communicationStyle;
  const setStyle = (patch: Partial<WhatsAppBotUIConfig['communicationStyle']>) =>
    onChange({ ...behavior, communicationStyle: { ...style, ...patch } });

  return (
    <SectionCard id="tone" icon={MessageCircle} title="Tone" description="How your agent sounds to customers.">
      <div className="space-y-6">
        <div>
          <p className="mb-2 text-sm font-medium text-text-primary">Tone of voice</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {TONES.map((t) => (
              <OptionCard key={t.value} selected={style.tone === t.value} onClick={() => setStyle({ tone: t.value })}>
                <p className="pr-6 font-semibold text-text-primary">{t.label}</p>
                <p className="mt-0.5 text-xs text-text-secondary">{t.description}</p>
                <p className="mt-3 rounded-lg bg-[#dcf8c6] px-3 py-2 text-xs text-gray-800 dark:bg-green-900/40 dark:text-green-50">
                  {t.example}
                </p>
              </OptionCard>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-text-primary">Reply length</p>
          <div className="grid grid-cols-3 gap-3">
            {LENGTHS.map((l) => (
              <OptionCard
                key={l.value}
                selected={style.responseLength === l.value}
                onClick={() => setStyle({ responseLength: l.value })}
              >
                <p className="pr-6 font-semibold text-text-primary">{l.label}</p>
                <p className="mt-0.5 text-xs text-text-secondary">{l.description}</p>
              </OptionCard>
            ))}
          </div>
        </div>

        <div className="space-y-4 border-t border-border pt-5">
          <Switch
            checked={style.useCustomerName}
            onChange={(v) => setStyle({ useCustomerName: v })}
            label="Use the customer's name"
            description="Address customers by their WhatsApp or saved name."
          />
          {style.useCustomerName && (
            <Switch
              checked={style.askNameEarly !== false}
              onChange={(v) => setStyle({ askNameEarly: v })}
              label="Ask the customer's name early"
              description="New customers are asked their name in the first reply, along with the answer. Known customers are never asked."
            />
          )}
          <Switch
            checked={behavior.customerExperience.enableTimeBasedGreetings}
            onChange={(v) =>
              onChange({ ...behavior, customerExperience: { ...behavior.customerExperience, enableTimeBasedGreetings: v } })
            }
            label="Time-based greetings"
            description='Open with "Good morning" or "Good evening" depending on the time.'
          />
        </div>
      </div>
    </SectionCard>
  );
}
