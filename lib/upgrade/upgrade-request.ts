import type { PlatformModule } from '@/lib/platform-modules';

/** The five versions of the upgrade popup (docs/plan/UNIFIED_UPGRADE_POPUP.md). */
export type UpgradeVariant = 'feature' | 'limit' | 'addon' | 'trial' | 'web';

/** What the popup should explain; built from a server reply or by the caller. */
export interface UpgradeRequest {
  variant: UpgradeVariant;
  featureKey?: string;
  featureName?: string;
  limitType?: string;
  current?: number;
  limit?: number;
  moduleKey?: PlatformModule;
  initialPlanId?: string;
  trialDaysLeft?: number;
  trialEndsOn?: string;
  /** Adding a product: the dialog opens on the plan list with the trial card. */
  showTrialOption?: boolean;
}

/** Features sold as the Khatario Connect add-on rather than a plan tier. */
export const ADDON_FEATURE_KEYS: ReadonlySet<string> = new Set([
  'integration_whatsapp_bot',
  'integration_whatsapp_manual',
  'whatsapp_bot',
  'whatsapp_send_message',
]);

const PLAN_DENIED_CODES = new Set(['FEATURE_NOT_IN_PLAN', 'FEATURE_NOT_AVAILABLE']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The popup to open for an API reply, or null. Only writes count: a read that is refused
 * (usage strips, probes) is handled by the page, never by a popup.
 */
export function upgradeRequestFromResponse(
  method: string,
  status: number,
  body: Record<string, unknown> | null,
): UpgradeRequest | null {
  if (!WRITE_METHODS.has(method.toUpperCase()) || status !== 403 || !body) return null;
  const code = typeof body.code === 'string' ? body.code : '';

  if (PLAN_DENIED_CODES.has(code)) {
    const featureKey = typeof body.feature === 'string' ? body.feature : undefined;
    if (featureKey && ADDON_FEATURE_KEYS.has(featureKey)) {
      return { variant: 'addon', featureKey, moduleKey: 'connect', initialPlanId: 'connect' };
    }
    return { variant: 'feature', ...(featureKey ? { featureKey } : {}) };
  }

  if (code === 'SUBSCRIPTION_LIMIT_EXCEEDED') {
    const req: UpgradeRequest = { variant: 'limit' };
    if (typeof body.limit_type === 'string') req.limitType = body.limit_type;
    const limit = numberOrUndefined(body.limit);
    const current = numberOrUndefined(body.current);
    if (limit !== undefined) req.limit = limit;
    if (current !== undefined) req.current = current;
    return req;
  }

  return null;
}

/** Same key = same popup, for "Maybe later" and to avoid stacking. */
export function upgradeRequestKey(req: UpgradeRequest): string {
  return `${req.variant}:${req.featureKey ?? req.limitType ?? ''}`;
}
