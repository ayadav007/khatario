/**
 * Where a notification tap goes. The server puts a site path in `data.href`; the client only
 * ever navigates inside the current origin, and only to a plain path, whatever the payload says.
 */
export type PushTapData = Record<string, unknown> | null | undefined;

export type PushTapPlan = {
  href: string;
  /** Business the notification belongs to, when it is not the one the session is on. */
  switchBusinessId: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeSitePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return null;
  if (/[\s<>"'`]/.test(v)) return null;
  return v;
}

export function planPushTap(
  data: PushTapData,
  ctx: { audience: 'business' | 'customer'; currentBusinessId?: string | null },
): PushTapPlan {
  const d = data && typeof data === 'object' ? data : {};
  const fallback = ctx.audience === 'business' ? '/notifications' : '/account';
  const href = safeSitePath(d.href) ?? fallback;
  let switchBusinessId: string | null = null;
  if (ctx.audience === 'business') {
    const biz = typeof d.business_id === 'string' && UUID_RE.test(d.business_id) ? d.business_id : null;
    if (biz && ctx.currentBusinessId && biz !== ctx.currentBusinessId) switchBusinessId = biz;
  }
  return { href, switchBusinessId };
}

/** Stable positive 31-bit id for a local notification, from the notification id or job id. */
export function localNotificationId(data: PushTapData): number {
  const d = data && typeof data === 'object' ? data : {};
  const key = String(d.notification_id || d.job_id || Date.now());
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}
