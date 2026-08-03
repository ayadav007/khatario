'use client';

import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProfileRequiredModal } from '@/contexts/ProfileRequiredModalContext';
import {
  type ProfileRequirementContext,
  getProfileGaps,
  isProfileReady,
} from '@/lib/business-profile-requirements';

/**
 * Returns true when profile satisfies the context; otherwise opens the contextual modal and returns false.
 */
export function useProfileRequiredGate() {
  const { business } = useAuth();
  const { openForMissingProfile } = useProfileRequiredModal();

  const ensureProfile = useCallback(
    (context: ProfileRequirementContext): boolean => {
      if (isProfileReady(business, context)) {
        return true;
      }
      openForMissingProfile({
        context,
        gaps: getProfileGaps(business, context),
      });
      return false;
    },
    [business, openForMissingProfile],
  );

  return { ensureProfile, business };
}
