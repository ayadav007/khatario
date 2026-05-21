'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/Button';

export function TrialExtensionModal() {
  const { business, subscription, loading: authLoading, refresh } = useAuth();
  const toast = useToastContext();
  const [open, setOpen] = useState(false);
  const [extensionDays, setExtensionDays] = useState(7);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState<'extend' | 'decline' | null>(null);

  const syncFromSession = useCallback(() => {
    if (subscription?.show_trial_extension_modal) {
      setExtensionDays(subscription.trial_extension_days ?? 7);
      setOpen(true);
      return true;
    }
    return false;
  }, [subscription]);

  const checkOffer = useCallback(async () => {
    if (authLoading || !business?.id) {
      return;
    }

    if (syncFromSession()) {
      return;
    }

    setChecking(true);
    try {
      const res = await fetch(
        `/api/subscriptions/trial-extension?business_id=${encodeURIComponent(business.id)}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) {
        setOpen(false);
        return;
      }
      const data = await res.json();
      setExtensionDays(data.extension_days ?? 7);
      setOpen(Boolean(data.show_modal));
    } catch {
      setOpen(false);
    } finally {
      setChecking(false);
    }
  }, [authLoading, business?.id, syncFromSession]);

  useEffect(() => {
    if (authLoading) return;

    if (syncFromSession()) {
      return;
    }

    void checkOffer();
  }, [authLoading, syncFromSession, checkOffer, subscription?.show_trial_extension_modal]);

  async function handleAction(action: 'extend' | 'decline') {
    if (!business?.id || submitting) return;

    setSubmitting(action);
    try {
      const res = await fetch('/api/subscriptions/trial-extension', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ business_id: business.id, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Something went wrong. Please try again.');
        return;
      }

      if (action === 'extend') {
        toast.success(data.message || `Trial extended by ${extensionDays} days.`);
      } else {
        toast.success(data.message || 'You are now on the Free plan.');
      }

      setOpen(false);
      await refresh();
      window.location.reload();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(null);
    }
  }

  if (authLoading || checking || !open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-extension-title"
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-white shadow-xl">
        <button
          type="button"
          onClick={() => void handleAction('decline')}
          disabled={submitting !== null}
          className="absolute right-3 top-3 rounded-md p-1 text-text-muted hover:bg-gray-100 hover:text-text-primary disabled:opacity-50"
          aria-label="Continue on Free plan"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-6 pt-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
            <CalendarClock className="h-6 w-6" />
          </div>

          <h2 id="trial-extension-title" className="text-xl font-bold text-text-primary">
            Your trial has expired
          </h2>
          <p className="mt-2 text-sm text-text-secondary leading-relaxed">
            You can get{' '}
            <span className="font-semibold text-text-primary">{extensionDays} more days</span> of
            full access — this one-time extension is available whenever you return after your trial
            ended.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              className="flex-1 justify-center"
              disabled={submitting !== null}
              onClick={() => void handleAction('extend')}
            >
              {submitting === 'extend' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Extending…
                </>
              ) : (
                `Extend for ${extensionDays} days`
              )}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="flex-1 justify-center"
              disabled={submitting !== null}
              onClick={() => void handleAction('decline')}
            >
              {submitting === 'decline' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating…
                </>
              ) : (
                'Continue on Free plan'
              )}
            </Button>
          </div>

          <p className="mt-4 text-xs text-text-muted">
            Free plan limits apply until you extend. You can upgrade anytime from Settings →
            Subscription.
          </p>
        </div>
      </div>
    </div>
  );
}
