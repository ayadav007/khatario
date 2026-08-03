'use client';

import type { JourneyStep } from '@/lib/hr/recruitment/onboarding/journey';
import { clsx } from 'clsx';

export function HiringJourneyTimeline({ steps }: { steps: JourneyStep[] }) {
  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h2 className="text-base font-semibold text-text-primary">You are here in our hiring journey</h2>
      <ol className="mt-4 space-y-4">
        {steps.map((step) => (
          <li key={step.key} className="flex gap-3">
            <span
              className={clsx(
                'mt-1 h-3 w-3 shrink-0 rounded-full',
                step.state === 'completed' && 'bg-green-600',
                step.state === 'current' && 'bg-blue-600 ring-4 ring-blue-100',
                step.state === 'upcoming' && 'bg-gray-300',
              )}
              aria-hidden
            />
            <div>
              <p className="text-sm font-medium text-text-primary">
                {step.label}
                {step.state === 'current' ? ' (Pending)' : ''}
              </p>
              {step.date ? (
                <p className="text-xs text-text-muted">{formatJourneyDate(step.date)}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatJourneyDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}
