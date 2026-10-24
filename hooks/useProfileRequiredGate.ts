'use client';

import { useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProfileRequiredModal, type ProfileFieldValues } from '@/contexts/ProfileRequiredModalContext';
import {
  type BusinessProfileLike,
  type ProfileRequirementContext,
  getProfileGaps,
  isProfileReady,
} from '@/lib/business-profile-requirements';

/**
 * Returns true when profile satisfies the context; otherwise opens the contextual modal and returns false.
 * Pass `onContinue` to re-run the blocked action once the user fills the missing fields in the modal.
 */
export function useProfileRequiredGate() {
  const { business } = useAuth();
  const { openForMissingProfile } = useProfileRequiredModal();
  // Fields saved from the modal; `onContinue` is a closure from the blocked render, so it can't see the refreshed session yet.
  const savedRef = useRef<ProfileFieldValues>({});

  const ensureProfile = useCallback(
    (context: ProfileRequirementContext, onContinue?: () => void): boolean => {
      const current = (business ? { ...business, ...savedRef.current } : null) as BusinessProfileLike;
      if (isProfileReady(current, context)) {
        return true;
      }
      openForMissingProfile({
        context,
        gaps: getProfileGaps(current, context),
        onResolved: (saved) => {
          savedRef.current = { ...savedRef.current, ...saved };
          onContinue?.();
        },
      });
      return false;
    },
    [business, openForMissingProfile],
  );

  return { ensureProfile, business };
}
