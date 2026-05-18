/**
 * Subscription rules for Khatario print footer — safe to import from client bundles.
 *
 * "Show footer" means show the small "Powered by Khatario" watermark on PDFs / receipts.
 */

/** Matches {@code platform_features.id} / {@code subscription_plan_features.feature_id} for custom branding */
export const PRINT_CUSTOM_BRANDING_REGISTRY_ID =
  'advanced_custom_branding' as const;

export type PrintBrandingSubscription = {
  plan_id?: string;
  status?: string;
};

/**
 * Decide whether to show the Khatario print watermark.
 *
 * **Server:** prefer passing nothing in `options` and using {@link maybeAppendKhatarioPrintFooter} which
 * calls {@link import('./print-branding').shouldShowKhatarioPrintFooter} (`hasFeatureAccess` + expired-paid guard).
 *
 * **Client:** pass `enabledFeatureIds` from `/api/features/enabled` (`enabledIds`) once the capability snapshot
 * is loaded — no DB calls — same registry ids as server.
 *
 * Behavior (unchanged intent):
 * - Missing subscription → show watermark (legacy free-tier assumption).
 * - Trial → always show watermark (even if trial plan lists custom branding — user visibility contract).
 * - Expired subscription on a **non-free** plan id → no watermark ("paid/expired tier" parity with paid).
 * - Otherwise: watermark iff the business **does not** have custom branding capability (feature matrix /
 *   legacy `plan_id === 'free'` when `enabledFeatureIds` omitted).
 */
export function shouldShowKhatarioFooterFromSubscription(
  sub: PrintBrandingSubscription | null | undefined,
  options?: {
    /** Registry feature ids (`enabledIds` from `/api/features/enabled`) */
    enabledFeatureIds?: readonly string[];
  }
): boolean {
  if (!sub) return true;
  if (sub.status === 'trial') return true;

  const planId = sub.plan_id;
  // Expired accounts that last had a paid plan id — never show watermark (mirror legacy "!free").
  if (sub.status === 'expired' && planId && planId !== 'free') {
    return false;
  }

  if (options?.enabledFeatureIds) {
    const hasCustomBranding = options.enabledFeatureIds.includes(
      PRINT_CUSTOM_BRANDING_REGISTRY_ID
    );
    // Empty / stale capability list — still suppress watermark when plan id is clearly paid (parity with legacy + server).
    if (
      !hasCustomBranding &&
      planId &&
      planId !== 'free' &&
      sub.status !== 'trial'
    ) {
      return false;
    }
    return !hasCustomBranding;
  }

  // Legacy plan-id fallback — same branching as historical `trial / free → else paid`.
  return planId === 'free';
}
