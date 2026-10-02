'use client';

import React, { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { MAX_TEST_NUMBERS } from '@/lib/ai-agent/types';
import { SectionCard } from './SectionCard';

export function TestNumbersSection({
  phones,
  saving,
  onSave,
}: {
  phones: string[];
  saving: boolean;
  onSave: (phones: string[]) => Promise<void>;
}) {
  const pad = (list: string[]) => [...list, '', '', ''].slice(0, MAX_TEST_NUMBERS);
  const [draft, setDraft] = useState<string[]>(pad(phones));
  useEffect(() => setDraft(pad(phones)), [phones]);

  const cleaned = draft.map((p) => p.replace(/\D/g, '')).filter(Boolean);
  const invalid = cleaned.some((p) => p.length < 10);
  const dirty = cleaned.join(',') !== phones.join(',');

  return (
    <SectionCard
      id="test-numbers"
      icon={Phone}
      title="Test numbers"
      description="In Test mode, only these numbers get AI replies."
      appliesImmediately
      actions={
        <Button size="sm" onClick={() => onSave(cleaned)} disabled={!dirty || invalid} isLoading={saving}>
          Save numbers
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {draft.map((p, i) => (
          <input
            key={i}
            className="input"
            inputMode="tel"
            value={p}
            placeholder={i === 0 ? '919876543210' : 'Optional'}
            onChange={(e) => setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))}
            aria-label={`Test number ${i + 1}`}
          />
        ))}
      </div>
      <p className={invalid ? 'mt-2 text-xs text-error' : 'mt-2 text-xs text-text-secondary'}>
        {invalid
          ? 'Use the full number with country code, e.g. 919876543210.'
          : 'Include the country code. Message your business number from one of these to try the agent for real.'}
      </p>
    </SectionCard>
  );
}
