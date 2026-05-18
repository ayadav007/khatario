/**
 * Free / trial businesses show a small Khatario footer on printed output (PDF + thermal).
 */

import { getBusinessSubscription } from '@/lib/subscription';
import { hasFeatureAccess } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';
import {
  shouldShowKhatarioFooterFromSubscription,
  type PrintBrandingSubscription,
} from '@/lib/print-branding-rules';

export { shouldShowKhatarioFooterFromSubscription };

/** Inline SVG + label — bottom-right overlay for HTML/Puppeteer PDFs (no external asset fetch). */
export const KHATARIO_PRINT_FOOTER_HTML = `
<div class="khatario-print-branding" style="position:fixed;bottom:4mm;right:4mm;z-index:2147483647;display:flex;align-items:center;gap:6px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:9px;color:#475569;line-height:1.15;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="#0f766e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="#0f766e" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
  <span style="font-weight:600;color:#334155;">Khatario</span>
</div>
`.trim();

/**
 * Server: aligns with Feature Registry ({@link hasFeatureAccess} / custom branding) plus the same guards as
 * {@link shouldShowKhatarioFooterFromSubscription}: trial watermark, expired non-free hides watermark.
 * Missing subscription rows are treated like free-tier (legacy DBs).
 */
export async function shouldShowKhatarioPrintFooter(
  businessId: string
): Promise<boolean> {
  const sub =
    (await getBusinessSubscription(businessId)) as PrintBrandingSubscription | null;

  const syncResult = shouldShowKhatarioFooterFromSubscription(sub);

  /* Trial + expired non-free branches are exhaustive for boolean outcome without hitting the matrix. */
  if (!businessId || !sub) {
    return syncResult;
  }
  if (sub.status === 'trial') return true;
  if (
    sub.status === 'expired' &&
    sub.plan_id &&
    sub.plan_id !== 'free'
  ) {
    return false;
  }

  try {
    const hasCustomBranding = await hasFeatureAccess(
      businessId,
      FeatureKeys.CUSTOM_BRANDING
    );
    /** Same parity as {@link print-branding-rules} client helper — paid plan id never shows watermark unless matrix denies. */
    if (
      !hasCustomBranding &&
      sub.plan_id &&
      sub.plan_id !== 'free'
    ) {
      return false;
    }
    return !hasCustomBranding;
  } catch {
    /* Matrix / lookup failure → safe visible branding (historic free-tier behavior). */
    return syncResult;
  }
}

/** Inject footer before {@code </body>}, or append if no body tag. */
export function appendKhatarioFooterToHtml(html: string): string {
  const footer = KHATARIO_PRINT_FOOTER_HTML;
  const lower = html.toLowerCase();
  const idx = lower.lastIndexOf('</body>');
  if (idx !== -1) {
    return html.slice(0, idx) + footer + html.slice(idx);
  }
  return `${html}${footer}`;
}

export async function maybeAppendKhatarioPrintFooter(html: string, businessId: string): Promise<string> {
  if (!businessId) return html;
  if (!(await shouldShowKhatarioPrintFooter(businessId))) return html;
  return appendKhatarioFooterToHtml(html);
}
