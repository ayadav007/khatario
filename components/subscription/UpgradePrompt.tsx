'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Check, Crown, Sparkles, Zap, Loader2 } from 'lucide-react';
import { UpgradeModal } from './UpgradeModal';
import { useAuth } from '@/contexts/AuthContext';
import {
  getFeatureDisplayName,
  getFeatureUpgradePitch,
} from '@/lib/feature-upgrade-labels';
import { formatPlanLabel } from '@/lib/format-plan-label';
import {
  USAGE_LIMIT_SHORT_LABELS,
  formatPlanLimit,
  isUsageNudgeLimitType,
} from '@/lib/subscription/usage-labels';

interface UpgradePromptProps {
  limitType?: 'invoices' | 'customers' | 'items' | 'users' | 'whatsapp' | 'feature';
  currentCount?: number;
  limit?: number;
  featureName?: string;
  featureKey?: string;
  onClose: () => void;
  onPurchaseSuccess?: () => Promise<void>;
}

interface RequiredPlanRow {
  planId: string;
  planDisplayName: string;
  /** From {@link getFeatureAccessInfo} — e.g. "Business plan" */
  planLabel?: string;
  priceMonthly: number;
}

interface RequiredPlan {
  planId: string;
  planDisplayName: string;
  planLabel?: string;
  priceMonthly: number;
  allPlansWithFeature: RequiredPlanRow[];
}

interface LimitRecommendedPlan {
  planId: string;
  planDisplayName: string;
  planLabel: string;
  priceMonthly: number;
  planLimit: number;
}

// Plan icon/color mapping (static config)
const PLAN_CONFIG: Record<string, {
  icon: React.ReactNode;
  color: string;
}> = {
  free: {
    icon: null,
    color: 'bg-gray-100 text-gray-800',
  },
  professional: {
    icon: <Sparkles className="w-4 h-4" />,
    color: 'bg-primary-600 text-white',
  },
  business: {
    icon: <Zap className="w-4 h-4" />,
    color: 'bg-purple-600 text-white',
  },
  enterprise: {
    icon: <Crown className="w-4 h-4" />,
    color: 'bg-gradient-to-r from-purple-600 to-primary-600 text-white',
  },
};

export function UpgradePrompt({
  limitType = 'feature',
  currentCount,
  limit,
  featureName,
  featureKey,
  onClose,
  onPurchaseSuccess,
}: UpgradePromptProps) {
  const router = useRouter();
  const { business } = useAuth();
  const [requiredPlan, setRequiredPlan] = useState<RequiredPlan | null>(null);
  const [limitRecommendedPlan, setLimitRecommendedPlan] =
    useState<LimitRecommendedPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Feature → lowest plan that includes the feature
  useEffect(() => {
    setRequiredPlan(null);
    if (!featureKey || limitType !== 'feature') return;

    let cancelled = false;
    setLoadingPlan(true);

    fetch(
      `/api/subscriptions/feature-plan?feature_key=${encodeURIComponent(featureKey)}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.requiredPlan) {
          setRequiredPlan(data.requiredPlan);
        }
      })
      .catch((err) => {
        console.error('Error fetching required plan:', err);
      })
      .finally(() => {
        if (!cancelled) setLoadingPlan(false);
      });

    return () => {
      cancelled = true;
    };
  }, [featureKey, limitType]);

  // Quantity limit → lowest paid plan with enough headroom
  useEffect(() => {
    setLimitRecommendedPlan(null);
    if (limitType === 'feature' || !business?.id || currentCount === undefined) return;

    let cancelled = false;
    setLoadingPlan(true);

    fetch(
      `/api/subscriptions/limit-plan?business_id=${encodeURIComponent(business.id)}&limit_type=${limitType}&current=${currentCount}`,
      { credentials: 'include' },
    )
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.recommendedPlan) {
          setLimitRecommendedPlan(data.recommendedPlan);
        }
      })
      .catch((err) => {
        console.error('Error fetching limit plan recommendation:', err);
      })
      .finally(() => {
        if (!cancelled) setLoadingPlan(false);
      });

    return () => {
      cancelled = true;
    };
  }, [limitType, business?.id, currentCount]);

  const displayName =
    featureName || getFeatureDisplayName(featureKey ?? undefined);

  /** Conversion copy sourced from centralized feature-map + fallback (see lib/feature-upgrade-labels). */
  const featurePitch =
    limitType === 'feature' ? getFeatureUpgradePitch(featureKey) : '';
  const lowestTierLabel = requiredPlan
    ? requiredPlan.planLabel ??
      formatPlanLabel(requiredPlan.planDisplayName)
    : '';
  const limitTierLabel = limitRecommendedPlan?.planLabel ?? '';
  const heroPlanId =
    limitType === 'feature' ? requiredPlan?.planId : limitRecommendedPlan?.planId;
  const heroLabel = limitType === 'feature' ? lowestTierLabel : limitTierLabel;
  const planInfo = heroPlanId ? PLAN_CONFIG[heroPlanId] : null;

  const messages: Omit<
    Record<
      'invoices' | 'customers' | 'items' | 'users' | 'whatsapp',
      { title: string; description: string; benefits: string[] }
    >,
    'feature'
  > = {
    invoices: {
      title: 'Invoice Limit Reached',
      description: `You've reached your limit of ${limit} invoices per month. Upgrade to continue creating invoices.`,
      benefits: [
        'Higher invoice quotas on paid plans',
        'Unlimited invoices on qualifying tiers',
        'All invoice templates included',
      ],
    },
    customers: {
      title: 'Customer Limit Reached',
      description: `You've reached your limit of ${limit} customers. Upgrade to add more customers.`,
      benefits: [
        'Unlimited customers',
        'Advanced customer tracking',
        'Credit limit management',
      ],
    },
    items: {
      title: 'Item Limit Reached',
      description: `You've reached your limit of ${limit} items. Upgrade to add more products.`,
      benefits: [
        'Unlimited items/products',
        'Advanced inventory tracking',
        'Low stock alerts',
      ],
    },
    users: {
      title: 'User Limit Reached',
      description: `You've reached your limit of ${limit} user(s). Upgrade to add more team members.`,
      benefits: [
        'More seats on higher tiers',
        'Team scalability as you grow',
        'Role-based permissions',
      ],
    },
    whatsapp: {
      title: 'WhatsApp Not Available',
      description: 'WhatsApp integration is not available in your current plan.',
      benefits: [
        'WhatsApp quotas on paid plans',
        'Higher daily limits with automation tiers',
        'Send invoices directly via WhatsApp',
      ],
    },
  };

  const featureUIMessage =
    limitType !== 'feature'
      ? null
      : ({
          title: `Unlock ${displayName}`,
          description: '',
          benefits: [] as string[],
        } satisfies { title: string; description: string; benefits: string[] });

  if (featureUIMessage) {
    featureUIMessage.benefits = [
      ...(requiredPlan
        ? [
            `Lowest qualifying plan: ${lowestTierLabel} (₹${requiredPlan.priceMonthly}/month)`,
            ...requiredPlan.allPlansWithFeature
              .slice(1, 3)
              .map(
                (p) =>
                  `Also on ${p.planLabel ?? formatPlanLabel(p.planDisplayName)} — ₹${p.priceMonthly}/month`
              ),
          ]
        : [
            'Choose the subscription tier that includes this feature',
            'Switch or cancel anytime from subscription settings',
          ]),
    ].filter(Boolean);
  }

  const resolvedMessage =
    limitType === 'feature' && featureUIMessage
      ? featureUIMessage
      : messages[limitType as keyof typeof messages];

  const limitBenefits =
    limitType !== 'feature' &&
    limitRecommendedPlan &&
    isUsageNudgeLimitType(limitType)
      ? [
          `${limitRecommendedPlan.planLabel} — ₹${limitRecommendedPlan.priceMonthly}/month (${formatPlanLimit(limitRecommendedPlan.planLimit, limitType)} ${USAGE_LIMIT_SHORT_LABELS[limitType]})`,
          ...resolvedMessage.benefits,
        ]
      : resolvedMessage.benefits;

  function handleComparePlans() {
    onClose();
    router.push('/settings/subscription');
  }

  function handleUpgrade() {
    setShowUpgradeModal(true);
  }

  function handleModalClose() {
    setShowUpgradeModal(false);
    onClose();
  }

  async function handleUpgradeSuccess() {
    setShowUpgradeModal(false);
    if (onPurchaseSuccess) {
      await onPurchaseSuccess();
    }
    onClose();
    // Refresh the page to show updated subscription
    window.location.reload();
  }

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-8 relative shadow-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Dynamic Plan Badge & Icon */}
        <div className="flex flex-col items-center mb-6">
          {requiredPlan && lowestTierLabel && limitType === 'feature' && (
            <div
              className={`${
                planInfo?.color ?? 'bg-primary-600 text-white'
              } px-4 py-2 rounded-full flex items-center space-x-2 mb-4 shadow-lg`}
            >
              {planInfo?.icon ?? (
                <Crown className="w-4 h-4 flex-shrink-0" />
              )}
              <span className="font-semibold">{lowestTierLabel} required</span>
            </div>
          )}
          {limitRecommendedPlan && limitType !== 'feature' && heroLabel && (
            <div
              className={`${
                planInfo?.color ?? 'bg-primary-600 text-white'
              } px-4 py-2 rounded-full flex items-center space-x-2 mb-4 shadow-lg`}
            >
              {planInfo?.icon ?? (
                <Crown className="w-4 h-4 flex-shrink-0" />
              )}
              <span className="font-semibold">Recommended: {heroLabel}</span>
            </div>
          )}
          
          {loadingPlan ? (
            <div className="bg-gray-100 dark:bg-slate-800 p-6 rounded-full mb-4">
              <Loader2 className="w-12 h-12 text-primary-600 animate-spin" />
            </div>
          ) : (
            <div className="bg-gray-100 dark:bg-slate-800 p-6 rounded-full mb-4">
              <Crown className="w-12 h-12 text-gray-700 dark:text-gray-200" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="text-center mb-6">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">
            {resolvedMessage.title}
          </h2>
          {limitType === 'feature' ? (
            <div className="text-gray-600 text-lg space-y-2 text-left sm:text-center">
              <p className="leading-relaxed">{featurePitch}</p>
              {requiredPlan && lowestTierLabel && (
                <p className="text-base text-gray-500">
                  {displayName} is included starting on {lowestTierLabel}.
                </p>
              )}
            </div>
          ) : (
            <p className="text-gray-600 text-lg">
              {resolvedMessage.description}
              {limitRecommendedPlan &&
                isUsageNudgeLimitType(limitType) &&
                ` We recommend ${limitRecommendedPlan.planLabel} for ${formatPlanLimit(limitRecommendedPlan.planLimit, limitType)} ${USAGE_LIMIT_SHORT_LABELS[limitType]}.`}
            </p>
          )}
        </div>

        {/* Current Usage (if applicable) */}
        {currentCount !== undefined && limit !== undefined && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">Current Usage:</span>
              <span className="font-semibold text-gray-900">
                {currentCount} / {limit}
              </span>
            </div>
            <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary-600 h-2 rounded-full"
                style={{ width: `${Math.min((currentCount / limit) * 100, 100)}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Benefits (neutral card per color rules) */}
        <div className="mb-6 bg-gray-50 dark:bg-slate-800/60 border border-border rounded-xl p-6">
          <p className="text-sm font-semibold text-gray-700 mb-4 text-center">Upgrade to unlock:</p>
          <ul className="space-y-3">
            {limitBenefits.map((benefit, index) => (
              <li key={index} className="flex items-start text-sm text-gray-700">
                <div className="bg-green-500 rounded-full p-0.5 mr-3 mt-0.5">
                  <Check className="w-4 h-4 text-white" />
                </div>
                <span className="flex-1">{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        {limitType === 'feature' ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleUpgrade}
              className="w-full px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-semibold shadow"
            >
              {loadingPlan
                ? 'Loading plans…'
                : lowestTierLabel
                  ? `Upgrade to ${lowestTierLabel}`
                  : 'Upgrade plan'}
            </button>
            <button
              type="button"
              onClick={handleComparePlans}
              className="w-full px-6 py-3 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition font-semibold text-gray-800"
            >
              Compare Plans
            </button>
          </div>
        ) : (
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="flex-1 px-6 py-3 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition font-semibold text-gray-700"
            >
              Maybe Later
            </button>
            <button
              onClick={handleUpgrade}
              className="flex-1 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-semibold shadow"
            >
              View Plans
            </button>
          </div>
        )}
      </div>
      </div>

      {/* Show UpgradeModal when View Plans is clicked */}
      {showUpgradeModal && (
        <UpgradeModal
          limitType={limitType}
          currentCount={currentCount}
          limit={limit}
          featureName={featureName || displayName}
          initialPlanId={
            limitType === 'feature'
              ? requiredPlan?.planId
              : limitRecommendedPlan?.planId
          }
          onClose={handleModalClose}
          onUpgradeSuccess={handleUpgradeSuccess}
        />
      )}
    </>
  );
}

