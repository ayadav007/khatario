'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Building2, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { INDIAN_STATES } from '@/lib/gst-utils';
import {
  type ProfileFieldGap,
  type ProfileRequirementContext,
  getBusinessAddress,
  getContextDescription,
  getContextTitle,
  getProfileSettingsUrl,
} from '@/lib/business-profile-requirements';

/** Business fields the modal can save, keyed like the PATCH /api/business/[id] body. */
export type ProfileFieldValues = Partial<
  Record<'name' | 'address_line1' | 'city' | 'state' | 'pincode' | 'gstin', string>
>;

export interface ProfileRequiredModalPayload {
  context: ProfileRequirementContext;
  gaps: ProfileFieldGap[];
  /** Runs after the missing fields are saved, so the user's action (save, print) continues in place. */
  onResolved?: (saved: ProfileFieldValues) => void;
}

export interface ProfileRequiredModalContextValue {
  openForMissingProfile: (payload: ProfileRequiredModalPayload) => void;
  dismiss: () => void;
}

const ProfileRequiredModalContext =
  createContext<ProfileRequiredModalContextValue | null>(null);

const GAP_FIELD: Record<string, keyof ProfileFieldValues> = {
  name: 'name',
  address: 'address_line1',
  city: 'city',
  state: 'state',
  pincode: 'pincode',
  gstin: 'gstin',
};

function validate(values: ProfileFieldValues, fields: (keyof ProfileFieldValues)[]): string | null {
  for (const f of fields) {
    if (!values[f]?.trim()) return 'Please fill in all the fields.';
  }
  if (fields.includes('pincode') && !/^\d{6}$/.test(values.pincode!.trim())) {
    return 'Pincode must be 6 digits.';
  }
  if (fields.includes('gstin') && !/^[0-9A-Z]{15}$/.test(values.gstin!.trim().toUpperCase())) {
    return 'GSTIN must be 15 characters.';
  }
  return null;
}

export function ProfileRequiredModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { business, branch, user, activeBranchCount, refresh } = useAuth();
  const visibleRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<ProfileRequiredModalPayload | null>(null);
  const [values, setValues] = useState<ProfileFieldValues>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismiss = useCallback(() => {
    visibleRef.current = false;
    setOpen(false);
    setPayload(null);
    setError(null);
  }, []);

  const openForMissingProfile = useCallback(
    (next: ProfileRequiredModalPayload) => {
      if (visibleRef.current) return;
      visibleRef.current = true;
      setValues({
        name: business?.name ?? '',
        address_line1: getBusinessAddress(business),
        city: business?.city ?? '',
        state: business?.state ?? '',
        pincode: business?.pincode ?? '',
        gstin: business?.gstin ?? '',
      });
      setError(null);
      setPayload(next);
      setOpen(true);
    },
    [business],
  );

  const value = useMemo<ProfileRequiredModalContextValue>(
    () => ({ openForMissingProfile, dismiss }),
    [openForMissingProfile, dismiss],
  );

  const fields = (payload?.gaps ?? [])
    .map((g) => GAP_FIELD[g.key])
    .filter((f): f is keyof ProfileFieldValues => Boolean(f));

  const set = (field: keyof ProfileFieldValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  const save = async () => {
    if (!business?.id || !payload) return;
    const problem = validate(values, fields);
    if (problem) {
      setError(problem);
      return;
    }
    const body: ProfileFieldValues = {};
    for (const f of fields) {
      const v = values[f]!.trim();
      body[f] = f === 'gstin' ? v.toUpperCase() : v;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/business/${business.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not save. Please try again.');
        return;
      }
      // Multi-outlet invoices print the branch address; keep the primary branch in step like Settings does.
      if (activeBranchCount > 1 && branch?.id && (branch as { is_primary?: boolean }).is_primary) {
        await fetch(`/api/branches/${branch.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_id: business.id, updated_by_user_id: user?.id, ...body }),
        }).catch(() => {});
      }
      await refresh();
      const onResolved = payload.onResolved;
      dismiss();
      onResolved?.(body);
    } catch {
      setError('Could not save. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const firstGap = payload?.gaps[0] ?? null;
  const canSaveInline = fields.length > 0;

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
          <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-white shadow-xl">
            <button
              type="button"
              onClick={dismiss}
              className="absolute right-3 top-3 rounded-md p-1 text-text-muted hover:bg-gray-100 hover:text-text-primary"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            <form
              className="p-6 pt-8"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                <Building2 className="h-6 w-6" />
              </div>

              <h2 id="profile-required-title" className="text-xl font-bold text-text-primary">
                {getContextTitle(payload.context)}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                {getContextDescription(payload.context)} Fill them in here — your invoice stays as it is.
              </p>

              <div className="mt-4 space-y-3">
                {fields.includes('name') && (
                  <Input label="Business name" value={values.name ?? ''} onChange={set('name')} autoFocus />
                )}
                {fields.includes('address_line1') && (
                  <Input
                    label="Business address"
                    value={values.address_line1 ?? ''}
                    onChange={set('address_line1')}
                    placeholder="Shop no., street, area"
                    autoFocus={!fields.includes('name')}
                  />
                )}
                {(fields.includes('city') || fields.includes('pincode')) && (
                  <div className="grid grid-cols-2 gap-3">
                    {fields.includes('city') && <Input label="City" value={values.city ?? ''} onChange={set('city')} />}
                    {fields.includes('pincode') && (
                      <Input
                        label="Pincode"
                        value={values.pincode ?? ''}
                        onChange={set('pincode')}
                        inputMode="numeric"
                        maxLength={6}
                      />
                    )}
                  </div>
                )}
                {fields.includes('state') && (
                  <div>
                    <label className="type-label block mb-1.5">State</label>
                    <select className="input" value={values.state ?? ''} onChange={set('state')}>
                      <option value="">Select state</option>
                      {INDIAN_STATES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {fields.includes('gstin') && (
                  <Input
                    label="GSTIN"
                    value={values.gstin ?? ''}
                    onChange={set('gstin')}
                    maxLength={15}
                    className="uppercase"
                    helperText="If you are not GST registered, set GST registration to Unregistered in Business Profile."
                  />
                )}
              </div>

              {error && <p className="mt-3 text-sm text-error">{error}</p>}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                {canSaveInline && (
                  <Button type="submit" className="flex-1 justify-center" disabled={saving}>
                    {saving ? 'Saving…' : 'Save and continue'}
                  </Button>
                )}
                <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={dismiss} disabled={saving}>
                  Not now
                </Button>
              </div>

              <a
                href={getProfileSettingsUrl(firstGap)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
              >
                Open full business profile in a new tab
                <ExternalLink className="h-3 w-3" />
              </a>
            </form>
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
