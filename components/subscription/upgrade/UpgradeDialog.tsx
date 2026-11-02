'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ShieldCheck, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { isPurchasableUpgradePlan } from '@/lib/subscription/trial-plan';
import { getFeatureRequiredModule, getLimitOwnerModule } from '@/lib/subscription/module-entitlements';
import type { LimitCheckType } from '@/lib/subscription/limit-registry';
import type { PlatformModule } from '@/lib/platform-modules';
import { buildUpgradeCopy, planBenefitLines, type RecommendedPlan } from '@/lib/upgrade/upgrade-copy';
import { upgradeRequestKey, type UpgradeRequest } from '@/lib/upgrade/upgrade-request';
import { markUpgradeDialogMounted } from '@/lib/upgrade/upgrade-fetch-watch';
import { snoozeUpgrade } from '@/lib/upgrade/upgrade-snooze';
import { UpgradeIllustration } from './UpgradeIllustration';
import { UpgradePlanPicker, type UpgradePlanRow } from './UpgradePlanPicker';

export const ANDROID_APP_URL =
  process.env.NEXT_PUBLIC_ANDROID_APP_URL ?? 'https://play.google.com/store/apps/details?id=com.khatario.phone';

export interface UpgradeDialogProps {
  request: UpgradeRequest;
  onClose: () => void;
  onUpgradeSuccess?: () => void;
  /** Only the `web` version uses it; it has no close button. */
  onSignOut?: () => void;
}

/** Which product's plans to offer for this request. */
export function upgradeModuleFor(req: UpgradeRequest): PlatformModule {
  if (req.moduleKey) return req.moduleKey;
  if (req.variant === 'addon') return 'connect';
  if (req.variant === 'limit' && req.limitType) {
    return getLimitOwnerModule(req.limitType as LimitCheckType) ?? 'billing';
  }
  if (req.variant === 'feature' && req.featureKey) return getFeatureRequiredModule(req.featureKey) ?? 'billing';
  return 'billing';
}

function maskPhone(phone?: string | null): string | null {
  const digits = (phone ?? '').replace(/\D/g, '').slice(-10);
  if (digits.length < 6) return null;
  return `${digits.slice(0, 2)}•••••${digits.slice(-3)}`;
}

function cheapestPaidPlan(plans: UpgradePlanRow[], line: string): UpgradePlanRow | null {
  return (
    plans
      .filter((p) => isPurchasableUpgradePlan(p.id) && p.is_public !== false && (p.product_line ?? 'billing') === line)
      .filter((p) => Number(p.price_monthly) > 0)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0] ?? null
  );
}

/**
 * The one upgrade popup (five versions, docs/plan/UNIFIED_UPGRADE_POPUP.md): an apology and the
 * cheapest plan that fixes it first, then the full plan list with payment on "Upgrade".
 */
export function UpgradeDialog({ request, onClose, onUpgradeSuccess, onSignOut }: UpgradeDialogProps) {
  const { business, user } = useAuth();
  const { enabledFeatureIds } = useLayoutData();
  const [step, setStep] = useState<'summary' | 'plans'>(request.showTrialOption ? 'plans' : 'summary');
  const [plans, setPlans] = useState<UpgradePlanRow[]>([]);
  const [plan, setPlan] = useState<RecommendedPlan | null>(null);
  const moduleKey = upgradeModuleFor(request);
  const copy = useMemo(() => buildUpgradeCopy(request, plan), [request, plan]);

  useEffect(() => markUpgradeDialogMounted(), []);

  useEffect(() => {
    if (!copy.closable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copy.closable, onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list: UpgradePlanRow[] = await fetch('/api/subscriptions/plans')
        .then((r) => (r.ok ? r.json() : { plans: [] }))
        .then((d) => d.plans ?? [])
        .catch(() => []);
      if (cancelled) return;
      setPlans(list);

      let found: RecommendedPlan | null = null;
      try {
        if ((request.variant === 'feature' || request.variant === 'addon') && request.featureKey) {
          const d = await fetch(`/api/subscriptions/feature-plan?feature_key=${encodeURIComponent(request.featureKey)}`).then((r) =>
            r.ok ? r.json() : null,
          );
          const p = d?.requiredPlan;
          if (p) found = { planId: p.planId, planLabel: p.planDisplayName, priceMonthly: Number(p.priceMonthly) || 0 };
        } else if (request.variant === 'limit' && request.limitType && business?.id) {
          const current = request.current ?? request.limit ?? 0;
          const d = await fetch(
            `/api/subscriptions/limit-plan?business_id=${encodeURIComponent(business.id)}&limit_type=${encodeURIComponent(
              request.limitType,
            )}&current=${current}`,
            { credentials: 'include' },
          ).then((r) => (r.ok ? r.json() : null));
          const p = d?.recommendedPlan;
          if (p) {
            found = { planId: p.planId, planLabel: p.planDisplayName, priceMonthly: Number(p.priceMonthly) || 0, planLimit: p.planLimit };
          }
        }
      } catch {
        found = null;
      }
      if (!found) {
        const fallback =
          request.initialPlanId != null
            ? list.find((p) => p.id === request.initialPlanId) ?? null
            : cheapestPaidPlan(list, moduleKey === 'connect' ? 'connect' : moduleKey === 'hr' ? 'hr' : 'billing');
        if (fallback) {
          found = { planId: fallback.id, planLabel: fallback.display_name, priceMonthly: Number(fallback.price_monthly) || 0 };
        }
      }
      if (!cancelled) setPlan(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [request, business?.id, moduleKey]);

  const planRow = plan ? plans.find((p) => p.id === plan.planId) : undefined;
  const benefits =
    copy.benefits.length > 0
      ? copy.benefits
      : planRow
        ? planBenefitLines(
            Object.entries(planRow.features?.features ?? {})
              .filter(([, on]) => on)
              .map(([id]) => id),
            enabledFeatureIds,
            request.featureKey,
          )
        : [];

  function later() {
    if (!copy.closable) {
      onSignOut?.();
      return;
    }
    try {
      snoozeUpgrade(upgradeRequestKey(request), new Date(), window.localStorage);
    } catch {
      // Storage blocked: closing is enough.
    }
    onClose();
  }

  const phone = maskPhone((user as { phone?: string } | null)?.phone);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-[rgba(3,43,35,0.55)] p-4 sm:items-center"
      onMouseDown={(e) => {
        if (copy.closable && e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-dialog-title"
        className="relative my-6 w-full max-w-[400px] overflow-hidden rounded-[18px] bg-[#fffdf9] text-[#1d2b28] shadow-2xl"
      >
        {copy.closable && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-10 rounded-full p-1 text-[#8a7b6b] hover:bg-white/70"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        )}

        {step === 'plans' ? (
          <UpgradePlanPicker
            moduleKey={moduleKey}
            initialPlanId={plan?.planId ?? request.initialPlanId}
            showTrialOption={request.showTrialOption}
            onBack={request.showTrialOption ? undefined : () => setStep('summary')}
            onClose={onClose}
            onUpgradeSuccess={onUpgradeSuccess}
          />
        ) : (
          <>
            <UpgradeIllustration copy={copy} className="block h-auto w-full" />
            <div className="px-5 pb-5 pt-4">
              <span className="mb-2 inline-block rounded-full bg-[#feecde] px-2.5 py-0.5 text-[11px] font-medium text-[#8e4b13]">
                {copy.tag}
              </span>
              <h2 id="upgrade-dialog-title" className="mb-1.5 text-[17px] font-semibold leading-snug text-primary-600">
                {copy.title}
              </h2>
              <p className="mb-3 text-[13.5px] leading-relaxed text-[#5c5247]">{copy.body}</p>

              <DetailBox request={request} benefits={benefits} planLabel={plan?.planLabel} planLimit={plan?.planLimit} phone={phone} />

              {plan && (
                <div className="mb-3 flex items-center justify-between rounded-xl border-[1.5px] border-accent-500 bg-[#fff8f1] px-3 py-2.5">
                  <div>
                    <p className="text-[11px] text-[#b05e17]">Recommended for you</p>
                    <p className="text-sm font-semibold text-primary-600">
                      {plan.planLabel}
                      {plan.priceMonthly > 0 && (
                        <>
                          {' '}
                          · ₹{plan.priceMonthly.toLocaleString('en-IN')}
                          <span className="text-[11px] font-normal text-[#7a6c5d]">/month</span>
                        </>
                      )}
                    </p>
                  </div>
                  <button type="button" onClick={() => setStep('plans')} className="text-xs text-primary-600 underline">
                    Compare plans
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setStep('plans')}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent-500 text-[15px] font-semibold text-white hover:bg-accent-600"
              >
                {copy.ctaLabel} <ArrowRight className="h-4 w-4" />
              </button>
              <p className="mt-2 flex items-center justify-center gap-1 text-[11.5px] text-[#8a7b6b]">
                <ShieldCheck className="h-3.5 w-3.5 text-[#1f9d6a]" /> Secure UPI or card · works right after payment
              </p>
              <button type="button" onClick={later} className="mx-auto mt-2 block text-[13px] text-[#8a7b6b] hover:text-[#5c5247]">
                {copy.laterLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DetailBox({
  request,
  benefits,
  planLabel,
  planLimit,
  phone,
}: {
  request: UpgradeRequest;
  benefits: string[];
  planLabel?: string;
  planLimit?: number;
  phone: string | null;
}) {
  const box = 'mb-3 rounded-xl bg-[#f6f0e8] px-3 py-2.5';

  if (request.variant === 'web') {
    return (
      <div className={`${box} flex items-center gap-3`}>
        <div className="shrink-0 rounded-lg bg-white p-1">
          <QRCodeSVG value={ANDROID_APP_URL} size={64} fgColor="#032B23" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-primary-600">Keep it free on your phone</p>
          <p className="text-xs leading-snug text-[#6b5f52]">
            Scan to get the Khatario app{phone ? `. Sign in with ${phone}` : ''}.
          </p>
          <a href={ANDROID_APP_URL} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-[#1f7a55] underline">
            Open the Play Store
          </a>
        </div>
      </div>
    );
  }

  if (request.variant === 'limit' && request.limit !== undefined && request.limit > 0) {
    const used = Math.min(request.current ?? request.limit, request.limit);
    const pct = Math.round((used / request.limit) * 100);
    return (
      <div className={box}>
        <div className="mb-1.5 flex justify-between text-xs text-[#5c5247]">
          <span>Used</span>
          <span className="font-semibold text-[#b05e17]">
            {used} of {request.limit}
          </span>
        </div>
        <div className="h-[7px] overflow-hidden rounded bg-[#eadfd2]">
          <div className="h-full bg-accent-500" style={{ width: `${pct}%` }} />
        </div>
        {planLabel && (
          <p className="mt-1.5 text-xs text-[#8a7b6b]">
            {planLimit === undefined || planLimit === -1 ? `${planLabel} has no limit on this` : `${planLabel} gives you ${planLimit}`}
          </p>
        )}
      </div>
    );
  }

  if (request.variant === 'trial') {
    const left = Math.max(request.trialDaysLeft ?? 0, 0);
    return (
      <div className={box}>
        <div className="mb-1.5 flex gap-[3px]">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className={`h-[7px] flex-1 rounded-sm ${i < 7 - Math.min(left, 7) ? 'bg-accent-500' : 'bg-[#eadfd2]'}`} />
          ))}
        </div>
        <div className="flex justify-between text-xs text-[#5c5247]">
          <span>{left > 0 ? `${left} ${left === 1 ? 'day' : 'days'} left` : 'Last day passed'}</span>
          {request.trialEndsOn && <span>Ends {request.trialEndsOn}</span>}
        </div>
      </div>
    );
  }

  if (benefits.length === 0) return null;
  return (
    <div className={box}>
      {planLabel && <p className="mb-1 text-xs text-[#8a7b6b]">{planLabel} also gives you</p>}
      {benefits.map((b) => (
        <p key={b} className="my-0.5 flex items-start gap-1.5 text-[12.5px] text-[#3d3a35]">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1f9d6a]" /> {b}
        </p>
      ))}
    </div>
  );
}
