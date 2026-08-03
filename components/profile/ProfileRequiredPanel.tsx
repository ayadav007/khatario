'use client';

import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  type ProfileFieldGap,
  type ProfileRequirementContext,
  getContextDescription,
  getContextTitle,
  getProfileSettingsUrl,
} from '@/lib/business-profile-requirements';

interface ProfileRequiredPanelProps {
  context: ProfileRequirementContext;
  gaps: ProfileFieldGap[];
  className?: string;
}

/**
 * Inline panel for pages that cannot function without profile fields (e.g. GST returns).
 */
export function ProfileRequiredPanel({
  context,
  gaps,
  className = '',
}: ProfileRequiredPanelProps) {
  const router = useRouter();
  const firstGap = gaps[0] ?? null;

  return (
    <div
      className={`flex min-h-[320px] items-center justify-center px-4 py-8 ${className}`}
      role="alert"
    >
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 border border-amber-200">
          <AlertCircle className="h-8 w-8 text-amber-700" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-text-primary">
          {getContextTitle(context)}
        </h2>
        <p className="mb-4 text-sm text-text-secondary">{getContextDescription(context)}</p>
        {gaps.length > 0 ? (
          <ul className="mb-6 inline-block rounded-lg border border-border bg-gray-50 px-4 py-3 text-left text-sm text-text-primary">
            {gaps.map((gap) => (
              <li key={gap.key} className="py-0.5">
                {gap.label}
              </li>
            ))}
          </ul>
        ) : null}
        <Button type="button" onClick={() => router.push(getProfileSettingsUrl(firstGap))}>
          Complete business profile
        </Button>
      </div>
    </div>
  );
}
