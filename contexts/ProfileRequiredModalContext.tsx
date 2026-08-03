'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { Building2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  type ProfileFieldGap,
  type ProfileRequirementContext,
  getContextDescription,
  getContextTitle,
  getProfileSettingsUrl,
} from '@/lib/business-profile-requirements';

export interface ProfileRequiredModalPayload {
  context: ProfileRequirementContext;
  gaps: ProfileFieldGap[];
}

export interface ProfileRequiredModalContextValue {
  openForMissingProfile: (payload: ProfileRequiredModalPayload) => void;
  dismiss: () => void;
}

const ProfileRequiredModalContext =
  createContext<ProfileRequiredModalContextValue | null>(null);

export function ProfileRequiredModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const visibleRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<ProfileRequiredModalPayload | null>(null);

  const dismiss = useCallback(() => {
    visibleRef.current = false;
    setOpen(false);
    setPayload(null);
  }, []);

  const openForMissingProfile = useCallback((next: ProfileRequiredModalPayload) => {
    if (visibleRef.current) return;
    visibleRef.current = true;
    setPayload(next);
    setOpen(true);
  }, []);

  const value = useMemo<ProfileRequiredModalContextValue>(
    () => ({ openForMissingProfile, dismiss }),
    [openForMissingProfile, dismiss],
  );

  const firstGap = payload?.gaps[0] ?? null;
  const settingsUrl = getProfileSettingsUrl(firstGap);

  return (
    <ProfileRequiredModalContext.Provider value={value}>
      {children}
      {open && payload ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-required-title"
        >
          <div className="relative w-full max-w-md rounded-xl border border-border bg-white shadow-xl">
            <button
              type="button"
              onClick={dismiss}
              className="absolute right-3 top-3 rounded-md p-1 text-text-muted hover:bg-gray-100 hover:text-text-primary"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="p-6 pt-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                <Building2 className="h-6 w-6" />
              </div>

              <h2 id="profile-required-title" className="text-xl font-bold text-text-primary">
                {getContextTitle(payload.context)}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                {getContextDescription(payload.context)}
              </p>

              <ul className="mt-4 space-y-1.5 rounded-lg border border-border bg-gray-50 px-3 py-2.5 text-sm text-text-primary">
                {payload.gaps.map((gap) => (
                  <li key={gap.key} className="flex items-center gap-2">
                    <span className="text-red-600" aria-hidden>
                      •
                    </span>
                    {gap.label}
                  </li>
                ))}
              </ul>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  className="flex-1 justify-center"
                  onClick={() => {
                    dismiss();
                    router.push(settingsUrl);
                  }}
                >
                  Complete profile
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1 justify-center"
                  onClick={dismiss}
                >
                  Not now
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </ProfileRequiredModalContext.Provider>
  );
}

export function useProfileRequiredModal(): ProfileRequiredModalContextValue {
  const ctx = useContext(ProfileRequiredModalContext);
  if (!ctx) {
    throw new Error('useProfileRequiredModal must be used within ProfileRequiredModalProvider');
  }
  return ctx;
}
