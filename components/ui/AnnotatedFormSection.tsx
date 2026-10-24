'use client';

import type { ReactNode } from 'react';
import { ProfileSection } from '@/components/settings/business-profile/ProfileSection';

/**
 * Settings / New Item style form band: left title + description, right card body.
 */
export function AnnotatedFormSection({
  title,
  description,
  children,
  id,
  tour,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  id?: string;
  tour?: string;
}) {
  return (
    <ProfileSection id={id} tour={tour} title={title} description={description ?? null}>
      <div className="card space-y-4 p-4 md:p-5">{children}</div>
    </ProfileSection>
  );
}
