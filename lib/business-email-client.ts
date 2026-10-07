import type { BusinessEmailConfigPublic } from '@/lib/business-email';

export type BusinessEmailReadyResult =
  | { ready: true; config: BusinessEmailConfigPublic }
  | { ready: false; config: BusinessEmailConfigPublic | null; forbidden?: boolean; error?: string };

/** Client check aligned with server `isBusinessEmailReady`. */
export function isPublicEmailConfigReady(config: BusinessEmailConfigPublic | null | undefined): boolean {
  if (!config?.enabled) return false;
  if (!config.has_password) return false;
  if (!config.from_email?.trim()) return false;
  return true;
}

export async function fetchBusinessEmailReady(businessId: string): Promise<BusinessEmailReadyResult> {
  try {
    const res = await fetch(`/api/settings/email?business_id=${encodeURIComponent(businessId)}`, {
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) {
      return { ready: false, config: null, forbidden: true, error: data.error || 'Not allowed' };
    }
    if (!res.ok) {
      return { ready: false, config: null, error: data.error || 'Failed to load email settings' };
    }
    const config = (data.config as BusinessEmailConfigPublic | null) ?? null;
    if (isPublicEmailConfigReady(config)) {
      return { ready: true, config: config! };
    }
    return { ready: false, config };
  } catch {
    return { ready: false, config: null, error: 'Failed to load email settings' };
  }
}
